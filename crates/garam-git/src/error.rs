use std::path::PathBuf;

use serde::Serialize;

use crate::GitVersion;

/// Machine-readable error category sent to the frontend.
///
/// The frontend turns each kind into a translated message via the
/// `errors:<kind>` i18n key, so adding a variant requires adding that key to
/// every locale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    GitNotFound,
    GitTooOld,
    NotARepository,
    BareRepository,
    PathNotFound,
    DestinationNotEmpty,
    RemoteNotFound,
    AuthenticationFailed,
    NetworkError,
    NothingToCommit,
    InvalidBranchName,
    BranchExists,
    BranchNotMerged,
    LocalChangesWouldBeOverwritten,
    MergeConflict,
    UnrelatedHistories,
    IdentityMissing,
    Cancelled,
    Unknown,
}

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("git executable not found")]
    NotFound,

    #[error("git {found} is older than the required {required}")]
    TooOld {
        found: GitVersion,
        required: GitVersion,
    },

    #[error("failed to run git: {0}")]
    Io(#[from] std::io::Error),

    #[error("git exited with {code:?}: {stderr}")]
    Failed {
        kind: ErrorKind,
        code: Option<i32>,
        stderr: String,
    },

    #[error("unexpected git output: {0}")]
    Parse(String),

    #[error("path does not exist or is not a directory: {}", .0.display())]
    PathNotFound(PathBuf),

    #[error("not a git repository: {}", .0.display())]
    NotARepository(PathBuf),

    #[error("bare repositories are not supported: {}", .0.display())]
    BareRepository(PathBuf),

    #[error("destination is not an empty directory: {}", .0.display())]
    DestinationNotEmpty(PathBuf),

    #[error("invalid branch name: {0}")]
    InvalidBranchName(String),

    #[error("operation cancelled")]
    Cancelled,
}

impl GitError {
    /// Builds a [`GitError::Failed`], classifying it from git's stderr.
    pub(crate) fn failed(code: Option<i32>, stderr: String) -> Self {
        Self::Failed {
            kind: classify(&stderr),
            code,
            stderr,
        }
    }

    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::NotFound => ErrorKind::GitNotFound,
            Self::TooOld { .. } => ErrorKind::GitTooOld,
            Self::Failed { kind, .. } => *kind,
            Self::PathNotFound(_) => ErrorKind::PathNotFound,
            Self::NotARepository(_) => ErrorKind::NotARepository,
            Self::BareRepository(_) => ErrorKind::BareRepository,
            Self::DestinationNotEmpty(_) => ErrorKind::DestinationNotEmpty,
            Self::Cancelled => ErrorKind::Cancelled,
            Self::InvalidBranchName(_) => ErrorKind::InvalidBranchName,
            Self::Io(_) | Self::Parse(_) => ErrorKind::Unknown,
        }
    }

    /// Raw technical detail shown behind a "details" toggle in the UI.
    pub fn detail(&self) -> Option<String> {
        match self {
            Self::NotFound | Self::Cancelled => None,
            Self::Failed { stderr, .. } => Some(stderr.trim().to_owned()),
            other => Some(other.to_string()),
        }
    }
}

/// Maps git's (English, because of `LC_ALL=C`) stderr to an [`ErrorKind`].
fn classify(stderr: &str) -> ErrorKind {
    // Checked in order; put more specific patterns first. Needles are
    // lowercase.
    const PATTERNS: &[(&str, ErrorKind)] = &[
        ("not a git repository", ErrorKind::NotARepository),
        (
            "would be overwritten by",
            ErrorKind::LocalChangesWouldBeOverwritten,
        ),
        (
            "please commit your changes or stash them",
            ErrorKind::LocalChangesWouldBeOverwritten,
        ),
        (
            "refusing to merge unrelated histories",
            ErrorKind::UnrelatedHistories,
        ),
        ("automatic merge failed", ErrorKind::MergeConflict),
        ("conflict (", ErrorKind::MergeConflict),
        ("is not fully merged", ErrorKind::BranchNotMerged),
        ("a branch named", ErrorKind::BranchExists),
        ("nothing to commit", ErrorKind::NothingToCommit),
        ("no changes added to commit", ErrorKind::NothingToCommit),
        ("please tell me who you are", ErrorKind::IdentityMissing),
        ("empty ident name", ErrorKind::IdentityMissing),
        (
            "already exists and is not an empty directory",
            ErrorKind::DestinationNotEmpty,
        ),
        ("could not read username", ErrorKind::AuthenticationFailed),
        ("could not read password", ErrorKind::AuthenticationFailed),
        ("authentication failed", ErrorKind::AuthenticationFailed),
        (
            "permission denied (publickey",
            ErrorKind::AuthenticationFailed,
        ),
        (
            "host key verification failed",
            ErrorKind::AuthenticationFailed,
        ),
        ("repository not found", ErrorKind::RemoteNotFound),
        (
            "does not appear to be a git repository",
            ErrorKind::RemoteNotFound,
        ),
        // "fatal: repository '<url>' not found" / "... does not exist"
        ("fatal: repository '", ErrorKind::RemoteNotFound),
        ("could not resolve host", ErrorKind::NetworkError),
        ("could not resolve hostname", ErrorKind::NetworkError),
        ("failed to connect", ErrorKind::NetworkError),
        ("connection timed out", ErrorKind::NetworkError),
        ("connection refused", ErrorKind::NetworkError),
        ("network is unreachable", ErrorKind::NetworkError),
    ];

    let lower = stderr.to_ascii_lowercase();
    PATTERNS
        .iter()
        .find(|(needle, _)| lower.contains(needle))
        .map_or(ErrorKind::Unknown, |(_, kind)| *kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_not_a_repository() {
        let stderr =
            "fatal: not a git repository (or any of the parent directories): .git\n".to_owned();
        assert_eq!(
            GitError::failed(Some(128), stderr).kind(),
            ErrorKind::NotARepository
        );
    }

    #[test]
    fn classifies_remote_failures() {
        let cases = [
            (
                "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
                ErrorKind::AuthenticationFailed,
            ),
            (
                "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
                ErrorKind::AuthenticationFailed,
            ),
            (
                "remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found",
                ErrorKind::RemoteNotFound,
            ),
            (
                "fatal: repository '/tmp/nope' does not exist",
                ErrorKind::RemoteNotFound,
            ),
            (
                "fatal: unable to access 'https://nope.invalid/x.git/': Could not resolve host: nope.invalid",
                ErrorKind::NetworkError,
            ),
            (
                "fatal: destination path 'x' already exists and is not an empty directory.",
                ErrorKind::DestinationNotEmpty,
            ),
        ];
        for (stderr, kind) in cases {
            assert_eq!(classify(stderr), kind, "{stderr}");
        }
    }

    #[test]
    fn falls_back_to_unknown() {
        assert_eq!(
            GitError::failed(Some(1), "fatal: something odd".into()).kind(),
            ErrorKind::Unknown
        );
    }
}
