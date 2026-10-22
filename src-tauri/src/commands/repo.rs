use std::path::{Path, PathBuf};
use std::sync::Arc;

use garam_git::{Git, GitError, repo};
use tauri::State;
use tauri::ipc::Channel;

use crate::askpass::Askpass;
use crate::commands::remote::{NetworkContext, RemoteEvent};
use crate::error::{AppError, AppErrorKind, AppResult, blocking};
use crate::operations::Operations;
use crate::repositories::{RepositoryEntry, RepositoryList, RepositoryStore};

type Store<'a> = State<'a, Arc<RepositoryStore>>;

#[tauri::command]
#[specta::specta]
pub fn repo_list(store: Store<'_>) -> RepositoryList {
    store.list()
}

/// Adds an existing repository. `path` may be any folder inside it.
#[tauri::command]
#[specta::specta]
pub async fn repo_add(store: Store<'_>, path: String) -> AppResult<RepositoryEntry> {
    let store = Arc::clone(&store);
    blocking(move || {
        let info = repo::open(&Git::locate()?, Path::new(&path))?;
        store.add(info)
    })
    .await
}

/// Runs `git init` in an existing folder that isn't a repository yet.
#[tauri::command]
#[specta::specta]
pub async fn repo_init_existing(store: Store<'_>, path: String) -> AppResult<RepositoryEntry> {
    let store = Arc::clone(&store);
    blocking(move || {
        let path = PathBuf::from(path);
        if !path.is_dir() {
            return Err(GitError::PathNotFound(path).into());
        }
        let info = repo::init(&Git::locate()?, &path)?;
        store.add(info)
    })
    .await
}

/// Creates `parent/name` and initializes a repository in it.
#[tauri::command]
#[specta::specta]
pub async fn repo_create(
    store: Store<'_>,
    parent: String,
    name: String,
) -> AppResult<RepositoryEntry> {
    let store = Arc::clone(&store);
    blocking(move || {
        let dest = destination(&parent, &name)?;
        if dest.exists() && dest.read_dir().map_err(GitError::from)?.next().is_some() {
            return Err(GitError::DestinationNotEmpty(dest).into());
        }
        let info = repo::init(&Git::locate()?, &dest)?;
        store.add(info)
    })
    .await
}

/// Clones `url` into `parent/name`, streaming progress and credential
/// prompts to `on_event`. Cancel with [`operation_cancel`] using the same
/// `operation_id`.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn repo_clone(
    store: Store<'_>,
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    operation_id: String,
    url: String,
    parent: String,
    name: String,
    on_event: Channel<RemoteEvent>,
) -> AppResult<RepositoryEntry> {
    let store = Arc::clone(&store);
    let dest = destination(&parent, &name)?;
    let info = NetworkContext::new(&operations, &askpass, operation_id, true, on_event)
        .run(move |git, cancel, progress| repo::clone(git, url.trim(), &dest, cancel, progress))
        .await?;
    blocking(move || store.add(info)).await
}

/// Cancels a running operation, declining any credential prompt it shows.
#[tauri::command]
#[specta::specta]
pub fn operation_cancel(
    operations: State<'_, Arc<Operations>>,
    askpass: State<'_, Arc<Askpass>>,
    operation_id: String,
) {
    operations.cancel(&operation_id);
    askpass.decline_all(&operation_id);
}

/// Removes a repository from Garam's list. Files on disk are untouched.
#[tauri::command]
#[specta::specta]
pub async fn repo_remove(store: Store<'_>, path: String) -> AppResult<()> {
    let store = Arc::clone(&store);
    blocking(move || store.remove(&path)).await
}

#[tauri::command]
#[specta::specta]
pub async fn repo_select(store: Store<'_>, path: String) -> AppResult<()> {
    let store = Arc::clone(&store);
    blocking(move || store.select(&path)).await
}

/// Chooses the GitHub account git uses for the repository's HTTPS
/// remotes; `None` goes back to the user's own git setup.
#[tauri::command]
#[specta::specta]
pub async fn repo_set_account(
    store: Store<'_>,
    path: String,
    account: Option<String>,
) -> AppResult<()> {
    let store = Arc::clone(&store);
    blocking(move || store.set_account(&path, account)).await
}

fn destination(parent: &str, name: &str) -> AppResult<PathBuf> {
    let name = validate_name(name)?;
    let parent = PathBuf::from(parent);
    if !parent.is_dir() {
        return Err(GitError::PathNotFound(parent).into());
    }
    Ok(parent.join(name))
}

/// Accepts a single folder name that is valid on every supported OS.
fn validate_name(name: &str) -> AppResult<&str> {
    const FORBIDDEN: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    let trimmed = name.trim();
    let invalid = trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.ends_with('.')
        || trimmed
            .chars()
            .any(|c| FORBIDDEN.contains(&c) || c.is_control());
    if invalid {
        Err(AppError::app(AppErrorKind::InvalidRepositoryName, None))
    } else {
        Ok(trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::validate_name;

    #[test]
    fn accepts_ordinary_names() {
        for name in ["garam", "내 프로젝트", "my-app.v2", " padded "] {
            assert!(validate_name(name).is_ok(), "{name}");
        }
        assert_eq!(validate_name(" padded ").unwrap(), "padded");
    }

    #[test]
    fn rejects_paths_and_reserved_characters() {
        for name in [
            "",
            "  ",
            ".",
            "..",
            "a/b",
            r"a\b",
            "a:b",
            "what?",
            "trailing.",
            "ta\tb",
        ] {
            assert!(validate_name(name).is_err(), "{name:?}");
        }
    }
}

/// Starts watching `path` for changes (or stops with `None`). The frontend
/// receives `repo-changed` events and refreshes.
#[tauri::command]
#[specta::specta]
pub fn repo_watch(
    app: tauri::AppHandle,
    watcher: State<'_, crate::watcher::RepoWatcher>,
    path: Option<String>,
) -> AppResult<()> {
    watcher
        .watch(&app, path)
        .map_err(|e| AppError::app(AppErrorKind::WatchFailed, Some(e.to_string())))
}
