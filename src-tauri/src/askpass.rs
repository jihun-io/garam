//! Credential prompts inside the app.
//!
//! git and ssh run Garam's own executable as their askpass program (see
//! [`garam_git::Git::with_askpass`]). Started that way, the process doesn't
//! open a window: [`run_helper_if_requested`] sends the prompt over a
//! localhost socket to the running app and prints the answer for git.
//!
//! The app side ([`Askpass`]) routes each prompt to the operation that
//! caused it, by the operation id passed in the helper's environment. An
//! operation without a registered handler (background fetch) gets no
//! answer, so git fails instead of waiting on a question nobody sees.

use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::env;
use std::hash::{BuildHasher, Hasher};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use garam_git::Git;
use garam_git::credential::{self, CredentialPrompt};
use serde::{Deserialize, Serialize};

const PORT_ENV: &str = "GARAM_ASKPASS_PORT";
const TOKEN_ENV: &str = "GARAM_ASKPASS_TOKEN";
const OPERATION_ENV: &str = "GARAM_ASKPASS_OPERATION";

/// How long a prompt waits for the user before git is told "no answer".
const ANSWER_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Upper bound on a request line; prompts are short.
const MAX_REQUEST_BYTES: u64 = 64 * 1024;

#[derive(Serialize, Deserialize)]
struct Request {
    token: String,
    operation: String,
    prompt: String,
}

#[derive(Serialize, Deserialize)]
struct Response {
    answer: Option<String>,
}

/// If this process was started by git or ssh as the askpass program,
/// answers the prompt and returns the exit code. Call before anything else
/// in `main`.
pub fn run_helper_if_requested() -> Option<i32> {
    let port = env::var(PORT_ENV).ok()?;
    let token = env::var(TOKEN_ENV).unwrap_or_default();
    let operation = env::var(OPERATION_ENV).unwrap_or_default();
    let prompt = env::args().nth(1).unwrap_or_default();
    let answer = port
        .parse()
        .ok()
        .and_then(|port| ask(port, &token, &operation, &prompt).ok().flatten());
    Some(match answer {
        Some(answer) => {
            let mut stdout = io::stdout();
            match writeln!(stdout, "{answer}").and_then(|()| stdout.flush()) {
                Ok(()) => 0,
                Err(_) => 1,
            }
        }
        // A non-zero exit tells git the question was declined.
        None => 1,
    })
}

/// The helper side: sends one prompt to the app and waits for the answer.
fn ask(port: u16, token: &str, operation: &str, prompt: &str) -> io::Result<Option<String>> {
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))?;
    let request = Request {
        token: token.to_owned(),
        operation: operation.to_owned(),
        prompt: prompt.to_owned(),
    };
    serde_json::to_writer(&mut stream, &request)?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line)?;
    let response: Response = serde_json::from_str(&line)?;
    Ok(response.answer)
}

/// A prompt waiting for the user, as sent to the frontend.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRequest {
    pub request_id: String,
    pub prompt: CredentialPrompt,
}

type Handler = Arc<dyn Fn(CredentialRequest) + Send + Sync>;

struct Pending {
    operation: String,
    reply: Sender<Option<String>>,
}

#[derive(Default)]
struct State {
    handlers: HashMap<String, Handler>,
    pending: HashMap<String, Pending>,
    next_id: u64,
}

struct Server {
    port: u16,
    token: String,
    program: PathBuf,
}

/// The app side of the relay. If the socket or the executable path isn't
/// available, git runs without askpass and prompts simply fail.
pub struct Askpass {
    server: Option<Server>,
    state: Arc<Mutex<State>>,
}

impl Askpass {
    pub fn start() -> Self {
        let state = Arc::new(Mutex::new(State::default()));
        let server = env::current_exe()
            .and_then(|program| Self::listen(&state, random_token()).map(|s| (program, s)))
            .map(|(program, (port, token))| Server {
                port,
                token,
                program,
            })
            .ok();
        Self { server, state }
    }

    fn listen(state: &Arc<Mutex<State>>, token: String) -> io::Result<(u16, String)> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        let state = Arc::clone(state);
        let expected = token.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let state = Arc::clone(&state);
                let expected = expected.clone();
                thread::spawn(move || {
                    let _ = serve(stream, &state, &expected);
                });
            }
        });
        Ok((port, token))
    }

    /// `git` set up to send prompts for `operation` to this app.
    pub fn git_for(&self, git: Git, operation: &str) -> Git {
        match &self.server {
            Some(server) => git
                .with_askpass(&server.program)
                .with_env(PORT_ENV, server.port.to_string())
                .with_env(TOKEN_ENV, &server.token)
                .with_env(OPERATION_ENV, operation),
            None => git,
        }
    }

    /// Sends prompts for `operation` to `handler` until the guard drops.
    pub fn register(
        &self,
        operation: &str,
        handler: impl Fn(CredentialRequest) + Send + Sync + 'static,
    ) -> Registration<'_> {
        self.lock()
            .handlers
            .insert(operation.to_owned(), Arc::new(handler));
        Registration {
            askpass: self,
            operation: operation.to_owned(),
        }
    }

    /// Answers a prompt (`None` declines it). Returns the operation it
    /// belonged to, or `None` if it was no longer waiting.
    pub fn respond(&self, request_id: &str, answer: Option<String>) -> Option<String> {
        let pending = self.lock().pending.remove(request_id)?;
        let _ = pending.reply.send(answer);
        Some(pending.operation)
    }

    /// Declines every prompt still waiting for `operation`.
    pub fn decline_all(&self, operation: &str) {
        // Dropping the reply senders wakes the waiting threads with no answer.
        self.lock()
            .pending
            .retain(|_, pending| pending.operation != operation);
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        lock(&self.state)
    }
}

pub struct Registration<'a> {
    askpass: &'a Askpass,
    operation: String,
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        self.askpass.lock().handlers.remove(&self.operation);
        self.askpass.decline_all(&self.operation);
    }
}

fn lock(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state.lock().unwrap_or_else(|e| e.into_inner())
}

/// Handles one helper connection: read the prompt, wait for the user,
/// write the answer.
fn serve(stream: TcpStream, state: &Mutex<State>, token: &str) -> io::Result<()> {
    let mut line = String::new();
    BufReader::new(stream.try_clone()?.take(MAX_REQUEST_BYTES)).read_line(&mut line)?;
    let request: Request = serde_json::from_str(&line)?;
    let answer = if request.token == token {
        wait_for_answer(state, &request)
    } else {
        None
    };
    let mut stream = stream;
    serde_json::to_writer(&mut stream, &Response { answer })?;
    stream.write_all(b"\n")?;
    stream.flush()
}

fn wait_for_answer(state: &Mutex<State>, request: &Request) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    let (handler, request_id) = {
        let mut state = lock(state);
        let handler = state.handlers.get(&request.operation).cloned()?;
        state.next_id += 1;
        let request_id = state.next_id.to_string();
        state.pending.insert(
            request_id.clone(),
            Pending {
                operation: request.operation.clone(),
                reply: tx,
            },
        );
        (handler, request_id)
    };
    handler(CredentialRequest {
        request_id: request_id.clone(),
        prompt: credential::parse_prompt(&request.prompt),
    });
    let answer = rx.recv_timeout(ANSWER_TIMEOUT).ok().flatten();
    lock(state).pending.remove(&request_id);
    answer
}

/// 128 random bits from the OS-seeded keys of `RandomState`, hex encoded.
fn random_token() -> String {
    (0..2)
        .map(|i| {
            let mut hasher = RandomState::new().build_hasher();
            hasher.write_u32(i);
            format!("{:016x}", hasher.finish())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use garam_git::credential::PromptKind;

    fn server() -> (Askpass, u16, String) {
        let askpass = Askpass::start();
        let server = askpass.server.as_ref().expect("server started");
        let (port, token) = (server.port, server.token.clone());
        (askpass, port, token)
    }

    #[test]
    fn relays_a_prompt_to_the_operation_and_back() {
        let (askpass, port, token) = server();
        let askpass = Arc::new(askpass);
        let responder = Arc::clone(&askpass);
        let _registration = askpass.register("op-1", move |request| {
            assert_eq!(request.prompt.kind, PromptKind::Password);
            let responder = Arc::clone(&responder);
            thread::spawn(move || {
                let op = responder.respond(&request.request_id, Some("hunter2".into()));
                assert_eq!(op.as_deref(), Some("op-1"));
            });
        });

        let answer = ask(port, &token, "op-1", "Password for 'https://example.com': ").unwrap();
        assert_eq!(answer.as_deref(), Some("hunter2"));
    }

    #[test]
    fn declines_unknown_operations_and_bad_tokens() {
        let (askpass, port, token) = server();
        let _registration = askpass.register("op-1", |_| panic!("must not be asked"));
        assert_eq!(ask(port, &token, "background", "Username: ").unwrap(), None);
        assert_eq!(ask(port, "wrong", "op-1", "Username: ").unwrap(), None);
    }

    #[test]
    fn dropping_the_registration_declines_waiting_prompts() {
        let (askpass, port, token) = server();
        let askpass = Arc::new(askpass);
        let (tx, rx) = mpsc::channel();
        let registration = askpass.register("op-1", move |request| {
            let _ = tx.send(request.request_id);
        });
        let asker = thread::spawn(move || ask(port, &token, "op-1", "Username: ").unwrap());
        let request_id = rx.recv().unwrap();
        drop(registration);
        assert_eq!(asker.join().unwrap(), None);
        assert_eq!(askpass.respond(&request_id, Some("late".into())), None);
    }

    #[test]
    fn tokens_are_random() {
        let a = random_token();
        assert_eq!(a.len(), 32);
        assert_ne!(a, random_token());
    }
}
