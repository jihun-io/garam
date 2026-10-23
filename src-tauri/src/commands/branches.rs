use std::path::Path;

use garam_git::Git;
use garam_git::branch::{
    self, BaseStatus, Branch, CleanupCandidate, DeletedBranch, MergeOutcome, MergePreview,
    SwitchMode, UpdateMode,
};

use crate::error::{AppResult, blocking};

#[tauri::command]
#[specta::specta]
pub async fn branch_list(repo: String) -> AppResult<Vec<Branch>> {
    blocking(move || Ok(branch::list(&Git::locate()?, Path::new(&repo))?)).await
}

/// Creates a branch at `start` (default: HEAD) and switches to it.
#[tauri::command]
#[specta::specta]
pub async fn branch_create(repo: String, name: String, start: Option<String>) -> AppResult<()> {
    blocking(move || {
        Ok(branch::create(
            &Git::locate()?,
            Path::new(&repo),
            &name,
            start.as_deref(),
        )?)
    })
    .await
}

/// Switches branches. `current` names the branch being left, used to label
/// a stash when `mode` is `leave_changes`.
#[tauri::command]
#[specta::specta]
pub async fn branch_switch(
    repo: String,
    target: Branch,
    mode: SwitchMode,
    current: Option<String>,
) -> AppResult<()> {
    blocking(move || {
        Ok(branch::switch(
            &Git::locate()?,
            Path::new(&repo),
            &target,
            mode,
            current.as_deref(),
        )?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn branch_rename(repo: String, from: String, to: String) -> AppResult<()> {
    blocking(move || {
        Ok(branch::rename(
            &Git::locate()?,
            Path::new(&repo),
            &from,
            &to,
        )?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn branch_delete(repo: String, name: String, force: bool) -> AppResult<()> {
    blocking(move || {
        Ok(branch::delete(
            &Git::locate()?,
            Path::new(&repo),
            &name,
            force,
        )?)
    })
    .await
}

/// What merging `branch` would bring into HEAD: commits, and the files that
/// would conflict.
#[tauri::command]
#[specta::specta]
pub async fn branch_merge_preview(repo: String, branch: String) -> AppResult<MergePreview> {
    blocking(move || {
        Ok(branch::merge_preview(
            &Git::locate()?,
            Path::new(&repo),
            &branch,
        )?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn branch_merge(repo: String, branch: String) -> AppResult<MergeOutcome> {
    blocking(move || Ok(branch::merge(&Git::locate()?, Path::new(&repo), &branch)?)).await
}

/// How far the remote's default branch has moved on from the current
/// branch; `None` where that doesn't apply (see [`branch::base_status`]).
#[tauri::command]
#[specta::specta]
pub async fn branch_base_status(repo: String) -> AppResult<Option<BaseStatus>> {
    blocking(move || Ok(branch::base_status(&Git::locate()?, Path::new(&repo))?)).await
}

/// Merges or rebases the current branch onto `base`.
#[tauri::command]
#[specta::specta]
pub async fn branch_update_from(
    repo: String,
    base: String,
    mode: UpdateMode,
) -> AppResult<MergeOutcome> {
    blocking(move || {
        Ok(branch::update_from(
            &Git::locate()?,
            Path::new(&repo),
            &base,
            mode,
        )?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn branch_cleanup_candidates(repo: String) -> AppResult<Vec<CleanupCandidate>> {
    blocking(move || {
        Ok(branch::cleanup_candidates(
            &Git::locate()?,
            Path::new(&repo),
        )?)
    })
    .await
}

/// Deletes branches, returning what undoing it takes.
#[tauri::command]
#[specta::specta]
pub async fn branch_delete_many(repo: String, names: Vec<String>) -> AppResult<Vec<DeletedBranch>> {
    blocking(move || {
        Ok(branch::delete_many(
            &Git::locate()?,
            Path::new(&repo),
            &names,
        )?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn branch_restore(repo: String, deleted: Vec<DeletedBranch>) -> AppResult<()> {
    blocking(move || {
        Ok(branch::restore(
            &Git::locate()?,
            Path::new(&repo),
            &deleted,
        )?)
    })
    .await
}
