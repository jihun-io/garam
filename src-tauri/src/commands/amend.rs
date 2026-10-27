use std::path::Path;

use garam_git::amend::{self, AmendEdit, AmendSession};
use garam_git::diff::FileDiff;
use garam_git::precommit::Finding;
use garam_git::{FileChange, Git, RepoStatus};

use super::changes::{ImageVersions, data_url};
use crate::error::{AppResult, blocking};

#[tauri::command]
#[specta::specta]
pub async fn amend_begin(repo: String, expected_head: String) -> AppResult<AmendSession> {
    blocking(move || {
        Ok(amend::begin(
            &Git::locate()?,
            Path::new(&repo),
            &expected_head,
        )?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn amend_status(repo: String, id: String) -> AppResult<RepoStatus> {
    blocking(move || Ok(amend::status(&Git::locate()?, Path::new(&repo), &id)?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn amend_diff(repo: String, id: String, file: FileChange) -> AppResult<FileDiff> {
    blocking(move || {
        Ok(amend::file_diff(
            &Git::locate()?,
            Path::new(&repo),
            &id,
            &file,
        )?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn amend_images(repo: String, id: String, file: FileChange) -> AppResult<ImageVersions> {
    blocking(move || {
        let before = amend::before_image(&Git::locate()?, Path::new(&repo), &id, &file.path)?
            .and_then(|bytes| data_url(&file.path, &bytes));
        let after = std::fs::read(Path::new(&repo).join(&file.path))
            .ok()
            .and_then(|bytes| data_url(&file.path, &bytes));
        Ok(ImageVersions { before, after })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn amend_edit(repo: String, id: String, edit: AmendEdit) -> AppResult<()> {
    blocking(move || Ok(amend::edit(&Git::locate()?, Path::new(&repo), &id, edit)?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn amend_check(repo: String, id: String) -> AppResult<Vec<Finding>> {
    blocking(move || Ok(amend::check(&Git::locate()?, Path::new(&repo), &id)?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn amend_save(repo: String, id: String, message: String) -> AppResult<String> {
    blocking(move || {
        Ok(amend::save(
            &Git::locate()?,
            Path::new(&repo),
            &id,
            &message,
        )?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn amend_cancel(repo: String, id: String) -> AppResult<()> {
    blocking(move || Ok(amend::cancel(&Git::locate()?, Path::new(&repo), &id)?)).await
}
