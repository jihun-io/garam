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
//!
//! The same executable also serves as git's credential helper
//! (`garam-credential <action>`), asking the app over the same socket:
//!
//! - for a repository's signed-in GitHub account, the app answers with the
//!   account's token without showing anything;
//! - where the user has no credential helper of their own, it remembers
//!   logins in the keychain. git sends `store` only after a login worked,
//!   and the app keeps it only if the user chose to; git sends `erase` when
//!   a login was refused, and the app drops it if it was the saved one.

use std::collections::{HashMap, HashSet};
use std::env;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use garam_git::Git;
use garam_git::credential::{self, CredentialPrompt, PromptKind};
use serde::{Deserialize, Serialize};

use crate::logins::LoginStore;

const PORT_ENV: &str = "GARAM_ASKPASS_PORT";
const TOKEN_ENV: &str = "GARAM_ASKPASS_TOKEN";
const OPERATION_ENV: &str = "GARAM_ASKPASS_OPERATION";
/// First argument git passes when running this executable as a credential
/// helper (see [`Askpass::git_for`]).
const CREDENTIAL_HELPER_ARG: &str = "garam-credential";

/// How long a prompt waits for the user before git is told "no answer".
const ANSWER_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Upper bound on a request line; prompts are short.
const MAX_REQUEST_BYTES: u64 = 64 * 1024;

#[derive(Serialize, Deserialize)]
struct Request {
    token: String,
    operation: String,
    prompt: String,
    /// Set when git asks the credential helper rather than askpass.
    #[serde(default)]
    credential: Option<CredentialQuery>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct CredentialQuery {
    /// `get`, `store` or `erase`.
    #[serde(default = "get_action")]
    action: String,
    protocol: String,
    host: String,
    #[serde(default)]
    username: Option<String>,
    /// Sent with `store` and `erase`.
    #[serde(default)]
    password: Option<String>,
}

fn get_action() -> String {
    "get".to_owned()
}

#[derive(Serialize, Deserialize)]
struct Response {
    answer: Option<String>,
    /// The username to go with `answer` for credential helper requests.
    #[serde(default)]
    username: Option<String>,
}

/// A signed-in account's login for one host, given to git through the
/// credential helper.
#[derive(Clone)]
pub struct HostCredential {
    /// e.g. `github.com`
    pub host: String,
    pub username: String,
    pub token: String,
}

/// If this process was started by git or ssh as the askpass program,
/// answers the prompt and returns the exit code. Call before anything else
/// in `main`.
pub fn run_helper_if_requested() -> Option<i32> {
    if env::args().nth(1).as_deref() == Some(CREDENTIAL_HELPER_ARG) {
        return Some(run_credential_helper());
    }
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

/// `garam-credential <action>`: passes git's request to the app, and for
/// `get` prints the login it answers with. Exits 0 with no output when
/// there is no answer, which tells git to try its other ways of asking.
fn run_credential_helper() -> i32 {
    let mut input = String::new();
    // git always writes the request; read it so git isn't blocked.
    let _ = io::stdin()
        .take(MAX_REQUEST_BYTES)
        .read_to_string(&mut input);
    let Some(action) = env::args()
        .nth(2)
        .filter(|a| matches!(a.as_str(), "get" | "store" | "erase"))
    else {
        return 0;
    };
    let request = credential::parse_helper_request(&input);
    let (Some(protocol), Some(host), Ok(port)) = (
        request.protocol,
        request.host,
        env::var(PORT_ENV).map(|p| p.parse::<u16>()),
    ) else {
        return 0;
    };
    let Ok(port) = port else { return 0 };
    let token = env::var(TOKEN_ENV).unwrap_or_default();
    let operation = env::var(OPERATION_ENV).unwrap_or_default();
    let get = action == "get";
    let query = CredentialQuery {
        action,
        protocol,
        host,
        username: request.username,
        password: request.password,
    };
    let response = send(port, &token, &operation, "", Some(query));
    if !get {
        return 0;
    }
    if let Ok(Response {
        answer: Some(password),
        username: Some(username),
    }) = response
    {
        let mut stdout = io::stdout();
        let _ = stdout
            .write_all(credential::format_helper_response(&username, &password).as_bytes())
            .and_then(|()| stdout.flush());
    }
    0
}

/// The helper side: sends one prompt to the app and waits for the answer.
fn ask(port: u16, token: &str, operation: &str, prompt: &str) -> io::Result<Option<String>> {
    Ok(send(port, token, operation, prompt, None)?.answer)
}

fn send(
    port: u16,
    token: &str,
    operation: &str,
    prompt: &str,
    credential: Option<CredentialQuery>,
) -> io::Result<Response> {
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))?;
    let request = Request {
        token: token.to_owned(),
        operation: operation.to_owned(),
        prompt: prompt.to_owned(),
        credential,
    };
    serde_json::to_writer(&mut stream, &request)?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line)?;
    Ok(serde_json::from_str(&line)?)
}

/// A prompt waiting for the user, as sent to the frontend.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRequest {
    pub request_id: String,
    pub prompt: CredentialPrompt,
    /// The answer can be remembered on this computer: it's a password and
    /// git has no credential helper to remember it.
    pub can_remember: bool,
}

type Handler = Arc<dyn Fn(CredentialRequest) + Send + Sync>;

struct Pending {
    operation: String,
    /// Whether the answer may be remembered (see [`CredentialRequest`]).
    can_remember: bool,
    reply: Sender<Option<String>>,
}

#[derive(Default)]
struct State {
    handlers: HashMap<String, Handler>,
    pending: HashMap<String, Pending>,
    /// Logins the credential helper may hand out, by operation.
    credentials: HashMap<String, HostCredential>,
    /// Operations where Garam remembers logins in place of a credential
    /// helper (see [`Askpass::remember_logins`]).
    remembering: HashSet<String>,
    /// Of those, the ones where the user asked to remember the password
    /// they typed; git's `store` after a successful login saves it.
    keep: HashSet<String>,
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
    pub fn start(logins: Arc<LoginStore>) -> Self {
        let state = Arc::new(Mutex::new(State::default()));
        let server = env::current_exe()
            .and_then(|program| {
                Self::listen(&state, &logins, random_token()?).map(|s| (program, s))
            })
            .map(|(program, (port, token))| Server {
                port,
                token,
                program,
            })
            .ok();
        Self { server, state }
    }

    fn listen(
        state: &Arc<Mutex<State>>,
        logins: &Arc<LoginStore>,
        token: String,
    ) -> io::Result<(u16, String)> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        let state = Arc::clone(state);
        let logins = Arc::clone(logins);
        let expected = token.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let state = Arc::clone(&state);
                let logins = Arc::clone(&logins);
                let expected = expected.clone();
                thread::spawn(move || {
                    let _ = serve(stream, &state, &logins, &expected);
                });
            }
        });
        Ok((port, token))
    }

    /// `git` set up to send prompts for `operation` to this app. With a
    /// `credential`, HTTPS requests for its host are answered with it,
    /// ahead of (and instead of) the user's own credential helpers. With
    /// `remember`, the app is git's credential helper for every host and
    /// keeps the logins the user chooses to (for users without a helper).
    pub fn git_for(
        &self,
        git: Git,
        operation: &str,
        credential: Option<&HostCredential>,
        remember: bool,
    ) -> Git {
        let Some(server) = &self.server else {
            return git;
        };
        let helper = credential::helper_command(&server.program, &[CREDENTIAL_HELPER_ARG]);
        let mut git = git
            .with_askpass(&server.program)
            .with_env(PORT_ENV, server.port.to_string())
            .with_env(TOKEN_ENV, &server.token)
            .with_env(OPERATION_ENV, operation);
        if remember {
            // Before the account's helper below, which then clears it for
            // the account's host.
            git = git.with_config("credential.helper", helper.clone());
        }
        match credential {
            Some(credential) => {
                git.with_credential_helper(&format!("https://{}", credential.host), &helper)
            }
            None => git,
        }
    }

    /// Offers to remember passwords typed for `operation`, and lets the
    /// credential helper keep them, until the guard drops. For operations
    /// whose git is set up with `remember` (see [`Askpass::git_for`]).
    pub fn remember_logins(&self, operation: &str) -> Remembering<'_> {
        self.lock().remembering.insert(operation.to_owned());
        Remembering {
            askpass: self,
            operation: operation.to_owned(),
        }
    }

    /// Lets the credential helper answer for `operation` with `credential`
    /// until the guard drops.
    pub fn provide(&self, operation: &str, credential: HostCredential) -> Provision<'_> {
        self.lock()
            .credentials
            .insert(operation.to_owned(), credential);
        Provision {
            askpass: self,
            operation: operation.to_owned(),
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

    /// Answers a prompt (`None` declines it); `remember` keeps a password
    /// once git says it worked. Returns the operation it belonged to, or
    /// `None` if it was no longer waiting.
    pub fn respond(
        &self,
        request_id: &str,
        answer: Option<String>,
        remember: bool,
    ) -> Option<String> {
        let mut state = self.lock();
        let pending = state.pending.remove(request_id)?;
        if pending.can_remember {
            if remember && answer.is_some() {
                state.keep.insert(pending.operation.clone());
            } else {
                state.keep.remove(&pending.operation);
            }
        }
        drop(state);
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

pub struct Provision<'a> {
    askpass: &'a Askpass,
    operation: String,
}

impl Drop for Provision<'_> {
    fn drop(&mut self) {
        self.askpass.lock().credentials.remove(&self.operation);
    }
}

pub struct Remembering<'a> {
    askpass: &'a Askpass,
    operation: String,
}

impl Drop for Remembering<'_> {
    fn drop(&mut self) {
        let mut state = self.askpass.lock();
        state.remembering.remove(&self.operation);
        state.keep.remove(&self.operation);
    }
}

fn lock(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state.lock().unwrap_or_else(|e| e.into_inner())
}

/// Handles one helper connection: read the prompt, wait for the user,
/// write the answer.
fn serve(
    stream: TcpStream,
    state: &Mutex<State>,
    logins: &LoginStore,
    token: &str,
) -> io::Result<()> {
    let mut line = String::new();
    BufReader::new(stream.try_clone()?.take(MAX_REQUEST_BYTES)).read_line(&mut line)?;
    let request: Request = serde_json::from_str(&line)?;
    let response = if request.token != token {
        Response {
            answer: None,
            username: None,
        }
    } else if let Some(query) = &request.credential {
        helper_request(state, logins, &request.operation, query)
    } else {
        Response {
            answer: wait_for_answer(state, &request),
            username: None,
        }
    };
    let mut stream = stream;
    serde_json::to_writer(&mut stream, &response)?;
    stream.write_all(b"\n")?;
    stream.flush()
}

/// Answers the credential helper. `get`: the account login provided for
/// `operation` if it's for the requested host, else a remembered login.
/// `store`: keeps the login if the user asked to. `erase`: drops the
/// remembered login if it's the one that was refused.
fn helper_request(
    state: &Mutex<State>,
    logins: &LoginStore,
    operation: &str,
    query: &CredentialQuery,
) -> Response {
    let none = Response {
        answer: None,
        username: None,
    };
    let (account, keep) = {
        let state = lock(state);
        let account = state
            .credentials
            .get(operation)
            .cloned()
            .filter(|c| query.protocol == "https" && query.host.eq_ignore_ascii_case(&c.host));
        (account, state.keep.contains(operation))
    };
    let (protocol, host) = (query.protocol.as_str(), query.host.as_str());
    match query.action.as_str() {
        "get" => {
            if let Some(c) = account {
                return Response {
                    answer: Some(c.token),
                    username: Some(c.username),
                };
            }
            match logins.find(protocol, host, query.username.as_deref()) {
                Ok(Some((username, secret))) => Response {
                    answer: Some(secret),
                    username: Some(username),
                },
                _ => none,
            }
        }
        // An account's token is the account's, never a remembered login.
        "store" if keep && account.is_none() => {
            if let (Some(username), Some(password)) = (&query.username, &query.password) {
                let _ = logins.save(protocol, host, username, password);
            }
            none
        }
        "erase" => {
            if let (Some(username), Some(password)) = (&query.username, &query.password)
                && let Ok(Some((_, saved))) = logins.find(protocol, host, Some(username))
                && &saved == password
            {
                let _ = logins.forget(protocol, host, username);
            }
            none
        }
        _ => none,
    }
}

fn wait_for_answer(state: &Mutex<State>, request: &Request) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    let prepared = {
        let mut state = lock(state);
        let handler = state.handlers.get(&request.operation).cloned()?;
        state.next_id += 1;
        let request_id = state.next_id.to_string();
        let prompt = credential::parse_prompt(&request.prompt);
        let can_remember =
            prompt.kind == PromptKind::Password && state.remembering.contains(&request.operation);
        state.pending.insert(
            request_id.clone(),
            Pending {
                operation: request.operation.clone(),
                can_remember,
                reply: tx,
            },
        );
        (handler, request_id, prompt, can_remember)
    };
    let (handler, request_id, prompt, can_remember) = prepared;
    handler(CredentialRequest {
        request_id: request_id.clone(),
        prompt,
        can_remember,
    });
    let answer = rx.recv_timeout(ANSWER_TIMEOUT).ok().flatten();
    lock(state).pending.remove(&request_id);
    answer
}

/// 128 random bits from the OS, hex encoded.
fn random_token() -> io::Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(io::Error::other)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::tests::MemoryVault;

    fn server() -> (Askpass, u16, String) {
        let (askpass, port, token, _) = server_with_logins();
        (askpass, port, token)
    }

    fn server_with_logins() -> (Askpass, u16, String, Arc<LoginStore>) {
        let dir = tempfile::tempdir().unwrap();
        let logins = Arc::new(LoginStore::load(
            dir.keep().join("logins.json"),
            Box::new(MemoryVault::default()),
        ));
        let askpass = Askpass::start(Arc::clone(&logins));
        let server = askpass.server.as_ref().expect("server started");
        let (port, token) = (server.port, server.token.clone());
        (askpass, port, token, logins)
    }

    fn query(action: &str, username: Option<&str>, password: Option<&str>) -> CredentialQuery {
        CredentialQuery {
            action: action.into(),
            protocol: "https".into(),
            host: "git.example.com".into(),
            username: username.map(Into::into),
            password: password.map(Into::into),
        }
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
                let op = responder.respond(&request.request_id, Some("hunter2".into()), false);
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
        assert_eq!(
            askpass.respond(&request_id, Some("late".into()), false),
            None
        );
    }

    #[test]
    fn hands_out_a_provided_login_for_its_host_only() {
        let (askpass, port, token) = server();
        let github = || CredentialQuery {
            host: "github.com".into(),
            ..query("get", None, None)
        };
        let _provision = askpass.provide(
            "op-1",
            HostCredential {
                host: "github.com".into(),
                username: "jihun-io".into(),
                token: "gho_abc".into(),
            },
        );

        let response = send(port, &token, "op-1", "", Some(github())).unwrap();
        assert_eq!(response.username.as_deref(), Some("jihun-io"));
        assert_eq!(response.answer.as_deref(), Some("gho_abc"));

        let other_host = CredentialQuery {
            host: "gitlab.com".into(),
            ..github()
        };
        assert_eq!(
            send(port, &token, "op-1", "", Some(other_host))
                .unwrap()
                .answer,
            None
        );
        assert_eq!(
            send(port, &token, "op-2", "", Some(github()))
                .unwrap()
                .answer,
            None
        );
        assert_eq!(
            send(port, "wrong", "op-1", "", Some(github()))
                .unwrap()
                .answer,
            None
        );
    }

    #[test]
    fn dropping_the_provision_stops_handing_out_the_login() {
        let (askpass, port, token) = server();
        let provision = askpass.provide(
            "op-1",
            HostCredential {
                host: "github.com".into(),
                username: "u".into(),
                token: "t".into(),
            },
        );
        drop(provision);
        let github = CredentialQuery {
            host: "github.com".into(),
            ..query("get", None, None)
        };
        assert_eq!(
            send(port, &token, "op-1", "", Some(github)).unwrap().answer,
            None
        );
    }

    /// Answers the operation's prompts with `answer`, remembering or not.
    fn answer_prompts(askpass: &Arc<Askpass>, operation: &str, answer: &str, remember: bool) {
        let responder = Arc::clone(askpass);
        let answer = answer.to_owned();
        let registration = askpass.register(operation, move |request| {
            let responder = Arc::clone(&responder);
            let answer = answer.clone();
            thread::spawn(move || {
                responder.respond(&request.request_id, Some(answer), remember);
            });
        });
        std::mem::forget(registration);
    }

    #[test]
    fn remembers_a_password_only_when_asked_and_after_it_worked() {
        let (askpass, port, token, logins) = server_with_logins();
        let askpass = Arc::new(askpass);
        let prompt = "Password for 'https://kim@git.example.com': ";
        let store = || query("store", Some("kim"), Some("token-1"));

        // Not chosen: git's store after the login is ignored.
        let _remembering = askpass.remember_logins("op-1");
        answer_prompts(&askpass, "op-1", "token-1", false);
        ask(port, &token, "op-1", prompt).unwrap();
        send(port, &token, "op-1", "", Some(store())).unwrap();
        assert!(logins.list().is_empty());

        // Chosen: kept once git stores it, and handed out next time.
        let _remembering = askpass.remember_logins("op-2");
        answer_prompts(&askpass, "op-2", "token-1", true);
        ask(port, &token, "op-2", prompt).unwrap();
        assert!(
            logins.list().is_empty(),
            "nothing before git says it worked"
        );
        send(port, &token, "op-2", "", Some(store())).unwrap();
        let response = send(port, &token, "op-3", "", Some(query("get", None, None))).unwrap();
        assert_eq!(response.username.as_deref(), Some("kim"));
        assert_eq!(response.answer.as_deref(), Some("token-1"));

        // A refused login that isn't the saved one leaves it; the saved one
        // goes once it's refused.
        let erase = |password| query("erase", Some("kim"), Some(password));
        send(port, &token, "op-4", "", Some(erase("other"))).unwrap();
        assert_eq!(logins.list().len(), 1);
        send(port, &token, "op-4", "", Some(erase("token-1"))).unwrap();
        assert!(logins.list().is_empty());
    }

    #[test]
    fn offers_to_remember_passwords_only_where_garam_remembers() {
        let (askpass, port, token) = server();
        let askpass = Arc::new(askpass);
        let (tx, rx) = mpsc::channel();
        let responder = Arc::clone(&askpass);
        let _registration = askpass.register("op-1", move |request| {
            let _ = tx.send((request.prompt.kind, request.can_remember));
            responder.respond(&request.request_id, Some("x".into()), false);
        });

        ask(
            port,
            &token,
            "op-1",
            "Password for 'https://git.example.com': ",
        )
        .unwrap();
        assert_eq!(rx.recv().unwrap(), (PromptKind::Password, false));

        let _remembering = askpass.remember_logins("op-1");
        ask(
            port,
            &token,
            "op-1",
            "Username for 'https://git.example.com': ",
        )
        .unwrap();
        assert_eq!(rx.recv().unwrap(), (PromptKind::Username, false));
        ask(
            port,
            &token,
            "op-1",
            "Password for 'https://git.example.com': ",
        )
        .unwrap();
        assert_eq!(rx.recv().unwrap(), (PromptKind::Password, true));
    }

    #[test]
    fn tokens_are_random() {
        let a = random_token().unwrap();
        assert_eq!(a.len(), 32);
        assert_ne!(a, random_token().unwrap());
    }
}
