use std::collections::BTreeMap;

use garam_git::{ErrorKind, GitError};
use serde::Serialize;

/// Errors that come from the app layer rather than from git.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum AppErrorKind {
    InvalidRepositoryName,
    StorageFailed,
    ExternalAppNotFound,
    ExternalAppFailed,
    TrashFailed,
    WatchFailed,
    /// A new window couldn't be opened.
    WindowFailed,
    /// A file the user chose to save couldn't be written.
    SaveFailed,
    /// The OS keychain refused to store or read a token.
    KeychainFailed,
    GithubUnreachable,
    /// The account's token was revoked or expired; sign in again.
    GithubUnauthorized,
    /// The sign-in code expired before it was approved.
    GithubLoginExpired,
    GithubLoginDenied,
    GithubUnexpected,
}

/// Either kind of error code; serialized as a plain string, so the frontend
/// sees one `ErrorKind | AppErrorKind` union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(untagged)]
pub enum ErrorCode {
    Git(ErrorKind),
    App(AppErrorKind),
}

/// Error shape returned by every command.
///
/// The frontend renders `kind` through the `errors:<kind>` i18n key,
/// interpolating `params`; `detail` holds raw output for a "details" toggle.
#[derive(Debug, Serialize, specta::Type)]
pub struct AppError {
    pub kind: ErrorCode,
    pub params: BTreeMap<String, String>,
    pub detail: Option<String>,
}

impl AppError {
    pub fn app(kind: AppErrorKind, detail: impl Into<Option<String>>) -> Self {
        Self {
            kind: ErrorCode::App(kind),
            params: BTreeMap::new(),
            detail: detail.into(),
        }
    }

    pub fn storage(err: impl std::fmt::Display) -> Self {
        Self::app(AppErrorKind::StorageFailed, Some(err.to_string()))
    }
}

impl From<GitError> for AppError {
    fn from(err: GitError) -> Self {
        let mut params = BTreeMap::new();
        if let GitError::TooOld { found, required } = &err {
            params.insert("found".into(), found.to_string());
            params.insert("required".into(), required.to_string());
        }
        Self {
            kind: ErrorCode::Git(err.kind()),
            params,
            detail: err.detail(),
        }
    }
}

impl From<garam_github::GitHubError> for AppError {
    fn from(err: garam_github::GitHubError) -> Self {
        use garam_github::ErrorKind as Kind;
        let kind = match err.kind() {
            Kind::Network => ErrorCode::App(AppErrorKind::GithubUnreachable),
            Kind::Unauthorized => ErrorCode::App(AppErrorKind::GithubUnauthorized),
            Kind::LoginExpired => ErrorCode::App(AppErrorKind::GithubLoginExpired),
            Kind::LoginDenied => ErrorCode::App(AppErrorKind::GithubLoginDenied),
            Kind::Cancelled => ErrorCode::Git(ErrorKind::Cancelled),
            Kind::Unexpected => ErrorCode::App(AppErrorKind::GithubUnexpected),
        };
        Self {
            kind,
            params: BTreeMap::new(),
            detail: Some(err.detail()),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Runs blocking work (git, file IO) off the async runtime's worker threads.
pub async fn blocking<T, F>(f: F) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError {
            kind: ErrorCode::Git(ErrorKind::Unknown),
            params: BTreeMap::new(),
            detail: Some(e.to_string()),
        })?
}
