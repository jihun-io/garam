use std::collections::BTreeMap;

use garam_git::{ErrorKind, GitError};
use serde::Serialize;

/// Error shape returned by every command.
///
/// The frontend renders `kind` through the `errors:<kind>` i18n key,
/// interpolating `params`; `detail` holds raw output for a "details" toggle.
#[derive(Debug, Serialize, specta::Type)]
pub struct AppError {
    pub kind: ErrorKind,
    pub params: BTreeMap<String, String>,
    pub detail: Option<String>,
}

impl From<GitError> for AppError {
    fn from(err: GitError) -> Self {
        let mut params = BTreeMap::new();
        if let GitError::TooOld { found, required } = &err {
            params.insert("found".into(), found.to_string());
            params.insert("required".into(), required.to_string());
        }
        Self {
            kind: err.kind(),
            params,
            detail: err.detail(),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Runs blocking git work off the async runtime's worker threads.
pub async fn blocking<T, F>(f: F) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError {
            kind: ErrorKind::Unknown,
            params: BTreeMap::new(),
            detail: Some(e.to_string()),
        })?
}
