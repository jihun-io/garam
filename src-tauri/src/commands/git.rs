use garam_git::Git;
use serde::Serialize;

use crate::error::{AppResult, blocking};

#[derive(Debug, Serialize, specta::Type)]
pub struct GitInfo {
    pub version: String,
    pub path: String,
}

/// Locates git and checks that its version is supported.
///
/// Called at startup; the frontend shows install guidance for
/// `git_not_found` / `git_too_old` errors.
#[tauri::command]
#[specta::specta]
pub async fn git_info() -> AppResult<GitInfo> {
    blocking(|| {
        let git = Git::locate()?;
        let version = git.require_supported_version()?;
        Ok(GitInfo {
            version: version.to_string(),
            path: git.path().display().to_string(),
        })
    })
    .await
}
