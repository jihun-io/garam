use std::path::Path;

use garam_git::commit::HeadCommit;
use garam_git::diff::FileDiff;
use garam_git::log::{
    self, CommitDetail, CommitFile, CommitSummary, HistoryFilter, HistoryMarkers, ResetMode,
};
use garam_git::{Git, tag};

use crate::error::{AppResult, blocking};

/// A page of the history `filter` selects, newest first.
#[tauri::command]
#[specta::specta]
pub async fn history_list(
    repo: String,
    filter: HistoryFilter,
    skip: u32,
    limit: u32,
) -> AppResult<Vec<CommitSummary>> {
    blocking(move || {
        Ok(log::list(
            &Git::locate()?,
            Path::new(&repo),
            &filter,
            skip,
            limit,
        )?)
    })
    .await
}

/// Refs, unpushed and incoming commits, shown alongside the history.
#[tauri::command]
#[specta::specta]
pub async fn history_markers(repo: String) -> AppResult<HistoryMarkers> {
    blocking(move || Ok(log::markers(&Git::locate()?, Path::new(&repo))?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn commit_detail(repo: String, oid: String) -> AppResult<CommitDetail> {
    blocking(move || Ok(log::detail(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn commit_file_diff(repo: String, oid: String, file: CommitFile) -> AppResult<FileDiff> {
    blocking(move || {
        Ok(log::file_diff(
            &Git::locate()?,
            Path::new(&repo),
            &oid,
            &file,
        )?)
    })
    .await
}

/// Adds a commit that undoes `oid`.
#[tauri::command]
#[specta::specta]
pub async fn commit_revert(repo: String, oid: String) -> AppResult<()> {
    blocking(move || Ok(log::revert(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

/// Applies `oid`'s changes as a new commit on HEAD.
#[tauri::command]
#[specta::specta]
pub async fn commit_cherry_pick(repo: String, oid: String) -> AppResult<()> {
    blocking(move || Ok(log::cherry_pick(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

/// Moves the current branch to `oid`.
#[tauri::command]
#[specta::specta]
pub async fn commit_reset(repo: String, oid: String, mode: ResetMode) -> AppResult<()> {
    blocking(move || Ok(log::reset(&Git::locate()?, Path::new(&repo), &oid, mode)?)).await
}

/// Undoes the last commit (`oid`), returning its message.
#[tauri::command]
#[specta::specta]
pub async fn commit_undo(repo: String, oid: String) -> AppResult<HeadCommit> {
    blocking(move || {
        Ok(log::undo_last_commit(
            &Git::locate()?,
            Path::new(&repo),
            &oid,
        )?)
    })
    .await
}

/// Checks out `oid` on a detached HEAD.
#[tauri::command]
#[specta::specta]
pub async fn commit_checkout(repo: String, oid: String) -> AppResult<()> {
    blocking(move || Ok(log::checkout(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

/// Tags `oid`; annotated when `message` is given.
#[tauri::command]
#[specta::specta]
pub async fn tag_create(
    repo: String,
    name: String,
    oid: String,
    message: Option<String>,
) -> AppResult<()> {
    blocking(move || {
        Ok(tag::create(
            &Git::locate()?,
            Path::new(&repo),
            &name,
            &oid,
            message.as_deref(),
        )?)
    })
    .await
}
