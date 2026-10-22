use std::path::Path;

use garam_git::Git;
use garam_git::conflict::{self, ConflictState, Side};

use crate::error::{AppResult, blocking};

#[tauri::command]
#[specta::specta]
pub async fn conflict_state(repo: String) -> AppResult<ConflictState> {
    blocking(move || Ok(conflict::state(&Git::locate()?, Path::new(&repo))?)).await
}

/// Keeps one side's version of a conflicted file.
#[tauri::command]
#[specta::specta]
pub async fn conflict_resolve(repo: String, path: String, side: Side) -> AppResult<()> {
    blocking(move || {
        Ok(conflict::resolve(
            &Git::locate()?,
            Path::new(&repo),
            &path,
            side,
        )?)
    })
    .await
}

/// Marks a file resolved as it is in the working folder.
#[tauri::command]
#[specta::specta]
pub async fn conflict_mark_resolved(repo: String, path: String) -> AppResult<()> {
    blocking(move || {
        Ok(conflict::mark_resolved(
            &Git::locate()?,
            Path::new(&repo),
            &path,
        )?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn conflict_continue(repo: String) -> AppResult<()> {
    blocking(move || {
        Ok(conflict::continue_operation(
            &Git::locate()?,
            Path::new(&repo),
        )?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn conflict_abort(repo: String) -> AppResult<()> {
    blocking(move || Ok(conflict::abort(&Git::locate()?, Path::new(&repo))?)).await
}
