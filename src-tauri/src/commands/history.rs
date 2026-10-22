use std::path::Path;

use garam_git::Git;
use garam_git::diff::FileDiff;
use garam_git::log::{self, CommitDetail, CommitFile, CommitSummary, HistoryMarkers};

use crate::error::{AppResult, blocking};

/// A page of HEAD's history, newest first.
#[tauri::command]
#[specta::specta]
pub async fn history_list(repo: String, skip: u32, limit: u32) -> AppResult<Vec<CommitSummary>> {
    blocking(move || Ok(log::list(&Git::locate()?, Path::new(&repo), skip, limit)?)).await
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
