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
            Self::Io(_) | Self::Parse(_) => ErrorKind::Unknown,
        }
    }

    /// Raw technical detail shown behind a "details" toggle in the UI.
    pub fn detail(&self) -> Option<String> {
        match self {
            Self::NotFound => None,
            Self::Failed { stderr, .. } => Some(stderr.trim().to_owned()),
            other => Some(other.to_string()),
        }
    }
}

/// Maps git's (English, because of `LC_ALL=C`) stderr to an [`ErrorKind`].
fn classify(stderr: &str) -> ErrorKind {
    const PATTERNS: &[(&str, ErrorKind)] = &[("not a git repository", ErrorKind::NotARepository)];

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
    fn falls_back_to_unknown() {
        assert_eq!(
            GitError::failed(Some(1), "fatal: something odd".into()).kind(),
            ErrorKind::Unknown
        );
    }
}
