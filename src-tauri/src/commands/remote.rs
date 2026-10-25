use std::path::{Path, PathBuf};
use std::sync::Arc;

use garam_git::credential;
use garam_git::remote::{self, PullOutcome, RemoteInfo, TagState};
use garam_git::{CancelToken, Git, GitError, Progress};
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

use crate::accounts::AccountStore;
use crate::askpass::{Askpass, CredentialRequest, HostCredential};
use crate::error::{AppResult, blocking};
use crate::logins::{LoginStore, SavedLogin};
use crate::operations::Operations;
use crate::repositories::RepositoryStore;

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
    /// Where to find the GitHub account chosen for the repository.
    pub account: Option<AccountSource>,
}

pub struct AccountSource {
    pub accounts: Arc<AccountStore>,
    pub choice: AccountChoice,
}

pub enum AccountChoice {
    /// Whatever is chosen for the repository at this path in Garam's list.
    Repository {
        repositories: Arc<RepositoryStore>,
        repo: String,
    },
    /// An account picked for a clone, before the repository is listed.
    Key(String),
}

impl AccountSource {
    /// The login of the account chosen for the repository. `None` when
    /// there is none, or it was signed out since.
    fn credential(&self) -> AppResult<Option<HostCredential>> {
        let key = match &self.choice {
            AccountChoice::Repository { repositories, repo } => repositories.account(repo),
            AccountChoice::Key(key) => Some(key.clone()),
        };
        let Some(key) = key else {
            return Ok(None);
        };
        let Some(account) = self.accounts.get(&key) else {
            return Ok(None);
        };
        Ok(self.accounts.token(&key)?.map(|token| HostCredential {
            host: account.host,
            username: account.login,
            token,
        }))
    }

    /// The repository whose git settings apply, when it exists yet.
    fn repo(&self) -> Option<&str> {
        match &self.choice {
            AccountChoice::Repository { repo, .. } => Some(repo),
            AccountChoice::Key(_) => None,
        }
    }
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
            account: None,
        }
    }

    /// Uses the GitHub account chosen for `repo`, if any.
    pub fn for_repo(
        mut self,
        repositories: &State<'_, Arc<RepositoryStore>>,
        accounts: &State<'_, Arc<AccountStore>>,
        repo: &Path,
    ) -> Self {
        self.account = Some(AccountSource {
            accounts: Arc::clone(accounts),
            choice: AccountChoice::Repository {
                repositories: Arc::clone(repositories),
                repo: repo.to_string_lossy().into_owned(),
            },
        });
        self
    }

    /// Uses the account with `key` (a clone, before the repository exists).
    pub fn with_account(mut self, accounts: &State<'_, Arc<AccountStore>>, key: String) -> Self {
        self.account = Some(AccountSource {
            accounts: Arc::clone(accounts),
            choice: AccountChoice::Key(key),
        });
        self
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
            let credential = match &self.account {
                Some(source) => source.credential()?,
                None => None,
            };
            let _provision = credential
                .clone()
                .map(|c| self.askpass.provide(&self.operation_id, c));
            let git = Git::locate()?;
            // Without a helper of the user's, git would forget every login
            // and ask each time; Garam remembers the ones the user chooses.
            // A clone has no repository yet, so only the user's settings count.
            let dir = match self.account.as_ref().and_then(AccountSource::repo) {
                Some(repo) => PathBuf::from(repo),
                None => std::env::temp_dir(),
            };
            let remember = !credential::has_helper(&git, &dir).unwrap_or(true);
            let _remembering = (remember && self.interactive)
                .then(|| self.askpass.remember_logins(&self.operation_id));
            let git = self
                .askpass
                .git_for(git, &self.operation_id, credential.as_ref(), remember);
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
#[allow(clippy::too_many_arguments)]
pub async fn remote_fetch(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    repositories: State<'_, Arc<RepositoryStore>>,
    accounts: State<'_, Arc<AccountStore>>,
    operation_id: String,
    repo: String,
    remote: String,
    interactive: bool,
    on_event: Channel<RemoteEvent>,
) -> AppResult<()> {
    let repo = PathBuf::from(repo);
    NetworkContext::new(&operations, &askpass, operation_id, interactive, on_event)
        .for_repo(&repositories, &accounts, &repo)
        .run(move |git, cancel, progress| remote::fetch(git, &repo, &remote, cancel, progress))
        .await
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn remote_pull(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    repositories: State<'_, Arc<RepositoryStore>>,
    accounts: State<'_, Arc<AccountStore>>,
    operation_id: String,
    repo: String,
    autostash: bool,
    on_event: Channel<RemoteEvent>,
) -> AppResult<PullOutcome> {
    let repo = PathBuf::from(repo);
    NetworkContext::new(&operations, &askpass, operation_id, true, on_event)
        .for_repo(&repositories, &accounts, &repo)
        .run(move |git, cancel, progress| remote::pull(git, &repo, autostash, cancel, progress))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn remote_push(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    repositories: State<'_, Arc<RepositoryStore>>,
    accounts: State<'_, Arc<AccountStore>>,
    operation_id: String,
    repo: String,
    on_event: Channel<RemoteEvent>,
) -> AppResult<()> {
    let repo = PathBuf::from(repo);
    NetworkContext::new(&operations, &askpass, operation_id, true, on_event)
        .for_repo(&repositories, &accounts, &repo)
        .run(move |git, cancel, progress| remote::push(git, &repo, cancel, progress))
        .await
}

/// Pushes the current branch to `remote` and sets it as the upstream.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn remote_publish(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    repositories: State<'_, Arc<RepositoryStore>>,
    accounts: State<'_, Arc<AccountStore>>,
    operation_id: String,
    repo: String,
    remote: String,
    on_event: Channel<RemoteEvent>,
) -> AppResult<()> {
    let repo = PathBuf::from(repo);
    NetworkContext::new(&operations, &askpass, operation_id, true, on_event)
        .for_repo(&repositories, &accounts, &repo)
        .run(move |git, cancel, progress| remote::publish(git, &repo, &remote, cancel, progress))
        .await
}

/// Deletes the tag `name` on `remote`.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn remote_tag_delete(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    repositories: State<'_, Arc<RepositoryStore>>,
    accounts: State<'_, Arc<AccountStore>>,
    operation_id: String,
    repo: String,
    remote: String,
    name: String,
    on_event: Channel<RemoteEvent>,
) -> AppResult<()> {
    let repo = PathBuf::from(repo);
    NetworkContext::new(&operations, &askpass, operation_id, true, on_event)
        .for_repo(&repositories, &accounts, &repo)
        .run(move |git, cancel, _| remote::delete_tag(git, &repo, &remote, &name, cancel))
        .await
}

/// How each local tag compares with `remote`'s. With `interactive: false`
/// (checked in the background), nothing asks the user to sign in.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn remote_tag_states(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    repositories: State<'_, Arc<RepositoryStore>>,
    accounts: State<'_, Arc<AccountStore>>,
    operation_id: String,
    repo: String,
    remote: String,
    interactive: bool,
    on_event: Channel<RemoteEvent>,
) -> AppResult<Vec<TagState>> {
    let repo = PathBuf::from(repo);
    NetworkContext::new(&operations, &askpass, operation_id, interactive, on_event)
        .for_repo(&repositories, &accounts, &repo)
        .run(move |git, cancel, _| remote::tag_states(git, &repo, &remote, cancel))
        .await
}

/// Pushes the tags `names` to `remote`; with `force`, replaces the
/// remote's tags of the same names.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn remote_tag_push(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    repositories: State<'_, Arc<RepositoryStore>>,
    accounts: State<'_, Arc<AccountStore>>,
    operation_id: String,
    repo: String,
    remote: String,
    names: Vec<String>,
    force: bool,
    on_event: Channel<RemoteEvent>,
) -> AppResult<()> {
    let repo = PathBuf::from(repo);
    NetworkContext::new(&operations, &askpass, operation_id, true, on_event)
        .for_repo(&repositories, &accounts, &repo)
        .run(move |git, cancel, progress| {
            remote::push_tags(git, &repo, &remote, &names, force, cancel, progress)
        })
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
    remember: bool,
) {
    let declined = answer.is_none();
    if let Some(operation) = askpass.respond(&request_id, answer, remember)
        && declined
    {
        operations.cancel(&operation);
    }
}

/// Logins remembered on this computer, newest first.
#[tauri::command]
#[specta::specta]
pub fn logins_list(logins: State<'_, Arc<LoginStore>>) -> Vec<SavedLogin> {
    logins.list()
}

/// Forgets a remembered login; git asks for it again next time.
#[tauri::command]
#[specta::specta]
pub async fn login_forget(
    logins: State<'_, Arc<LoginStore>>,
    protocol: String,
    host: String,
    username: String,
) -> AppResult<()> {
    let logins = Arc::clone(&logins);
    blocking(move || logins.forget(&protocol, &host, &username)).await
}
