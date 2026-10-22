use std::path::{Path, PathBuf};
use std::sync::Arc;

use garam_git::remote::{self, PullOutcome, RemoteInfo};
use garam_git::{CancelToken, Git, GitError, Progress};
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

use crate::askpass::{Askpass, CredentialRequest};
use crate::error::{AppResult, blocking};
use crate::operations::Operations;

/// Streamed to the frontend while a network operation runs.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RemoteEvent {
    Progress(Progress),
    /// git or ssh needs an answer; reply with [`credential_respond`].
    Credential(CredentialRequest),
}

/// Shared state for one network operation.
pub struct NetworkContext {
    pub operations: Arc<Operations>,
    pub askpass: Arc<Askpass>,
    pub operation_id: String,
    /// Whether prompts reach the user. Background work declines them.
    pub interactive: bool,
    pub on_event: Channel<RemoteEvent>,
}

impl NetworkContext {
    pub fn new(
        operations: &State<'_, Arc<Operations>>,
        askpass: &State<'_, Arc<Askpass>>,
        operation_id: String,
        interactive: bool,
        on_event: Channel<RemoteEvent>,
    ) -> Self {
        Self {
            operations: Arc::clone(operations),
            askpass: Arc::clone(askpass),
            operation_id,
            interactive,
            on_event,
        }
    }

    /// Runs `f` on a blocking thread with a cancellable, prompt-aware git.
    pub async fn run<T, F>(self, f: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&Git, &CancelToken, &mut dyn FnMut(Progress)) -> Result<T, GitError>
            + Send
            + 'static,
    {
        blocking(move || {
            let guard = self.operations.start(self.operation_id.clone());
            let events = self.on_event.clone();
            let _registration = self.interactive.then(|| {
                self.askpass.register(&self.operation_id, move |request| {
                    let _ = events.send(RemoteEvent::Credential(request));
                })
            });
            let git = self.askpass.git_for(Git::locate()?, &self.operation_id);
            let on_event = self.on_event.clone();
            let mut on_progress = move |p: Progress| {
                let _ = on_event.send(RemoteEvent::Progress(p));
            };
            Ok(f(&git, &guard.token, &mut on_progress)?)
        })
        .await
    }
}

#[tauri::command]
#[specta::specta]
pub async fn remote_info(repo: String) -> AppResult<RemoteInfo> {
    blocking(move || Ok(remote::info(&Git::locate()?, Path::new(&repo))?)).await
}

/// Fetches `remote`. With `interactive: false` (background fetch), nothing
/// asks the user for credentials.
#[tauri::command]
#[specta::specta]
pub async fn remote_fetch(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    operation_id: String,
    repo: String,
    remote: String,
    interactive: bool,
    on_event: Channel<RemoteEvent>,
) -> AppResult<()> {
    let repo = PathBuf::from(repo);
    NetworkContext::new(&operations, &askpass, operation_id, interactive, on_event)
        .run(move |git, cancel, progress| remote::fetch(git, &repo, &remote, cancel, progress))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn remote_pull(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    operation_id: String,
    repo: String,
    on_event: Channel<RemoteEvent>,
) -> AppResult<PullOutcome> {
    let repo = PathBuf::from(repo);
    NetworkContext::new(&operations, &askpass, operation_id, true, on_event)
        .run(move |git, cancel, progress| remote::pull(git, &repo, cancel, progress))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn remote_push(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    operation_id: String,
    repo: String,
    on_event: Channel<RemoteEvent>,
) -> AppResult<()> {
    let repo = PathBuf::from(repo);
    NetworkContext::new(&operations, &askpass, operation_id, true, on_event)
        .run(move |git, cancel, progress| remote::push(git, &repo, cancel, progress))
        .await
}

/// Pushes the current branch to `remote` and sets it as the upstream.
#[tauri::command]
#[specta::specta]
pub async fn remote_publish(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    operation_id: String,
    repo: String,
    remote: String,
    on_event: Channel<RemoteEvent>,
) -> AppResult<()> {
    let repo = PathBuf::from(repo);
    NetworkContext::new(&operations, &askpass, operation_id, true, on_event)
        .run(move |git, cancel, progress| remote::publish(git, &repo, &remote, cancel, progress))
        .await
}

/// Answers a credential prompt; `None` declines it and cancels the
/// operation that asked.
#[tauri::command]
#[specta::specta]
pub fn credential_respond(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    request_id: String,
    answer: Option<String>,
) {
    let declined = answer.is_none();
    if let Some(operation) = askpass.respond(&request_id, answer)
        && declined
    {
        operations.cancel(&operation);
    }
}
