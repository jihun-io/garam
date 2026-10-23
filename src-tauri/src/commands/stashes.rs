use std::path::Path;

use garam_git::Git;
use garam_git::diff::FileDiff;
use garam_git::log::CommitFile;
use garam_git::stash::{self, ApplyOutcome, AutoStash, Stash};

use crate::error::{AppResult, blocking};

#[tauri::command]
#[specta::specta]
pub async fn stash_list(repo: String) -> AppResult<Vec<Stash>> {
    blocking(move || Ok(stash::list(&Git::locate()?, Path::new(&repo))?)).await
}

/// Puts the uncommitted changes aside, or only `paths` when given, and
/// returns the new stash's id.
#[tauri::command]
#[specta::specta]
pub async fn stash_push(
    repo: String,
    message: Option<String>,
    include_untracked: bool,
    paths: Vec<String>,
) -> AppResult<String> {
    blocking(move || {
        Ok(stash::push(
            &Git::locate()?,
            Path::new(&repo),
            message.as_deref(),
            include_untracked,
            &paths,
        )?)
    })
    .await
}

/// Applies a stash, and with `pop` removes it once applied cleanly.
#[tauri::command]
#[specta::specta]
pub async fn stash_apply(repo: String, oid: String, pop: bool) -> AppResult<ApplyOutcome> {
    blocking(move || Ok(stash::apply(&Git::locate()?, Path::new(&repo), &oid, pop)?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn stash_drop(repo: String, oid: String) -> AppResult<()> {
    blocking(move || Ok(stash::drop(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

/// Puts a just-dropped stash back.
#[tauri::command]
#[specta::specta]
pub async fn stash_restore(repo: String, oid: String) -> AppResult<()> {
    blocking(move || Ok(stash::restore(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

/// Creates a branch where the stash was made and pops it there.
#[tauri::command]
#[specta::specta]
pub async fn stash_branch(repo: String, oid: String, name: String) -> AppResult<()> {
    blocking(move || {
        Ok(stash::branch(
            &Git::locate()?,
            Path::new(&repo),
            &oid,
            &name,
        )?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn stash_files(repo: String, oid: String) -> AppResult<Vec<CommitFile>> {
    blocking(move || Ok(stash::files(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn stash_file_diff(
    repo: String,
    oid: String,
    file: CommitFile,
    ignore_whitespace: bool,
) -> AppResult<FileDiff> {
    blocking(move || {
        Ok(stash::file_diff(
            &Git::locate()?,
            Path::new(&repo),
            &oid,
            &file,
            ignore_whitespace,
        )?)
    })
    .await
}

/// The stash Garam made when the user last left `branch`, if any.
#[tauri::command]
#[specta::specta]
pub async fn stash_find_auto(repo: String, branch: String) -> AppResult<Option<AutoStash>> {
    blocking(move || {
        Ok(stash::find_auto(
            &Git::locate()?,
            Path::new(&repo),
            &branch,
        )?)
    })
    .await
}
