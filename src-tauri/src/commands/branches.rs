use std::path::Path;

use garam_git::Git;
use garam_git::branch::{self, Branch, MergeOutcome, SwitchMode};

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

/// How many commits merging `branch` would bring into HEAD.
#[tauri::command]
#[specta::specta]
pub async fn branch_merge_preview(repo: String, branch: String) -> AppResult<u32> {
    blocking(move || {
        Ok(branch::commits_to_merge(
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
