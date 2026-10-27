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
    /// A pull stopped before merging because of local changes; it can be
    /// retried with them stashed.
    PullBlockedByLocalChanges,
    MergeConflict,
    RebaseConflict,
    RevertConflict,
    CherryPickConflict,
    /// The branch already has the commit's changes; nothing was picked.
    CherryPickEmpty,
    /// No changes matched, so no stash was made.
    NothingToStash,
    /// The stash was dropped or popped elsewhere since the list was read.
    StashNotFound,
    /// An untracked file in the stash already exists; nothing was applied.
    StashUntrackedExists,
    InvalidTagName,
    TagExists,
    /// The remote already has a tag of that name on another commit.
    RemoteTagExists,
    /// HEAD moved since the screen was drawn (e.g. a commit from a terminal).
    HeadMoved,
    /// The commits aren't consecutive on the current branch, or a merge
    /// is among or after them.
    CannotSquash,
    /// The commits aren't the newest ones on the current branch's
    /// first-parent line, or a merge is among them.
    CannotReorder,
    /// Commit or stash changes to tracked files first.
    UncommittedChanges,
    UnrelatedHistories,
    /// The remote has commits the local branch doesn't; pull first.
    NonFastForward,
    /// The server refused the push (protected branch, hook, ...).
    PushRejected,
    /// The branch was configured to only fast-forward, but it diverged.
    CannotFastForward,
    NoUpstream,
    /// The upstream branch no longer exists on the remote.
    RemoteBranchNotFound,
    NoRemote,
    DetachedHead,
    /// Continuing needs every conflicted file resolved first.
    ConflictsRemain,
    NothingInProgress,
    IdentityMissing,
    Cancelled,
    // The commit is published, outside the current linear history, or an operation is active.
    CannotReword,
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

    #[error("invalid tag name: {0}")]
    InvalidTagName(String),

    #[error("HEAD is no longer the expected commit")]
    HeadMoved,

    #[error("these commits can't be squashed")]
    CannotSquash,

    #[error("these commits can't be reordered")]
    CannotReorder,

    #[error("this commit message cannot be changed")]
    CannotReword,

    #[error("tracked files have uncommitted changes")]
    UncommittedChanges,

    #[error("HEAD is detached")]
    DetachedHead,

    #[error("the current branch has no upstream")]
    NoUpstream,

    #[error("the upstream branch no longer exists on the remote")]
    RemoteBranchNotFound,

    #[error("no such remote")]
    NoRemote,

    #[error("conflicted files remain")]
    ConflictsRemain,

    #[error("there are no changes to stash")]
    NothingToStash,

    #[error("no such stash")]
    StashNotFound,

    #[error("stashed untracked files already exist: {}", .0.join(", "))]
    StashUntrackedExists(Vec<String>),

    #[error("no merge, rebase, revert or cherry-pick is in progress")]
    NothingInProgress,

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
            Self::InvalidTagName(_) => ErrorKind::InvalidTagName,
            Self::HeadMoved => ErrorKind::HeadMoved,
            Self::CannotSquash => ErrorKind::CannotSquash,
            Self::CannotReorder => ErrorKind::CannotReorder,
            Self::CannotReword => ErrorKind::CannotReword,
            Self::UncommittedChanges => ErrorKind::UncommittedChanges,
            Self::DetachedHead => ErrorKind::DetachedHead,
            Self::NoUpstream => ErrorKind::NoUpstream,
            Self::RemoteBranchNotFound => ErrorKind::RemoteBranchNotFound,
            Self::NoRemote => ErrorKind::NoRemote,
            Self::ConflictsRemain => ErrorKind::ConflictsRemain,
            Self::NothingToStash => ErrorKind::NothingToStash,
            Self::StashNotFound => ErrorKind::StashNotFound,
            Self::StashUntrackedExists(_) => ErrorKind::StashUntrackedExists,
            Self::NothingInProgress => ErrorKind::NothingInProgress,
            Self::Io(_) | Self::Parse(_) => ErrorKind::Unknown,
        }
    }

    /// Raw technical detail shown behind a "details" toggle in the UI.
    pub fn detail(&self) -> Option<String> {
        match self {
            Self::NotFound
            | Self::Cancelled
            | Self::DetachedHead
            | Self::HeadMoved
            | Self::CannotSquash
            | Self::CannotReorder
            | Self::CannotReword
            | Self::UncommittedChanges
            | Self::NoUpstream
            | Self::RemoteBranchNotFound
            | Self::NoRemote
            | Self::ConflictsRemain
            | Self::NothingToStash
            | Self::StashNotFound
            | Self::NothingInProgress => None,
            Self::Failed { stderr, .. } => Some(stderr.trim().to_owned()),
            Self::StashUntrackedExists(paths) => Some(paths.join("\n")),
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
        // A rebase conflict also prints "CONFLICT (...)", so check it first.
        ("could not apply", ErrorKind::RebaseConflict),
        ("could not revert", ErrorKind::RevertConflict),
        ("automatic merge failed", ErrorKind::MergeConflict),
        ("conflict (", ErrorKind::MergeConflict),
        ("is not fully merged", ErrorKind::BranchNotMerged),
        ("a branch named", ErrorKind::BranchExists),
        ("fatal: tag '", ErrorKind::TagExists),
        (
            "could not restore untracked files from stash",
            ErrorKind::StashUntrackedExists,
        ),
        ("nothing to commit", ErrorKind::NothingToCommit),
        ("no changes added to commit", ErrorKind::NothingToCommit),
        ("please tell me who you are", ErrorKind::IdentityMissing),
        ("empty ident name", ErrorKind::IdentityMissing),
        (
            "already exists and is not an empty directory",
            ErrorKind::DestinationNotEmpty,
        ),
        ("[remote rejected]", ErrorKind::PushRejected),
        ("pre-receive hook declined", ErrorKind::PushRejected),
        (
            "because the tag already exists in the remote",
            ErrorKind::RemoteTagExists,
        ),
        ("updates were rejected because", ErrorKind::NonFastForward),
        ("(non-fast-forward)", ErrorKind::NonFastForward),
        ("(fetch first)", ErrorKind::NonFastForward),
        ("not possible to fast-forward", ErrorKind::CannotFastForward),
        ("there is no tracking information", ErrorKind::NoUpstream),
        ("has no upstream branch", ErrorKind::NoUpstream),
        ("no such ref was fetched", ErrorKind::RemoteBranchNotFound),
        ("couldn't find remote ref", ErrorKind::RemoteBranchNotFound),
        ("could not read username", ErrorKind::AuthenticationFailed),
        ("could not read password", ErrorKind::AuthenticationFailed),
        ("authentication failed", ErrorKind::AuthenticationFailed),
        (
            "invalid username or password",
            ErrorKind::AuthenticationFailed,
        ),
        ("http basic: access denied", ErrorKind::AuthenticationFailed),
        ("returned error: 401", ErrorKind::AuthenticationFailed),
        ("returned error: 403", ErrorKind::AuthenticationFailed),
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
        ("operation timed out", ErrorKind::NetworkError),
        (
            "the remote end hung up unexpectedly",
            ErrorKind::NetworkError,
        ),
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
    fn classifies_sync_failures() {
        let cases = [
            (
                "To /tmp/remote.git\n ! [rejected]        main -> main (fetch first)\n\
                 error: failed to push some refs to '/tmp/remote.git'\n\
                 hint: Updates were rejected because the remote contains work that you do not\n",
                ErrorKind::NonFastForward,
            ),
            (
                " ! [rejected]        main -> main (non-fast-forward)\n\
                 hint: Updates were rejected because the tip of your current branch is behind\n",
                ErrorKind::NonFastForward,
            ),
            (
                "remote: error: GH006: Protected branch update failed for refs/heads/main.\n\
                 To github.com:a/b.git\n ! [remote rejected] main -> main (protected branch hook declined)\n",
                ErrorKind::PushRejected,
            ),
            (
                "hint: Diverging branches can't be fast-forwarded, you need to either:\n\
                 fatal: Not possible to fast-forward, aborting.\n",
                ErrorKind::CannotFastForward,
            ),
            (
                "There is no tracking information for the current branch.\n",
                ErrorKind::NoUpstream,
            ),
            (
                "fatal: The current branch topic has no upstream branch.\n",
                ErrorKind::NoUpstream,
            ),
            (
                "fatal: couldn't find remote ref refs/heads/gone\n",
                ErrorKind::RemoteBranchNotFound,
            ),
            (
                "CONFLICT (content): Merge conflict in a.txt\n\
                 error: could not apply 1234567... Local change\n",
                ErrorKind::RebaseConflict,
            ),
            (
                "CONFLICT (content): Merge conflict in a.txt\n\
                 Automatic merge failed; fix conflicts and then commit the result.\n",
                ErrorKind::MergeConflict,
            ),
            (
                "remote: Invalid username or password.\n\
                 fatal: Authentication failed for 'https://github.com/a/b.git/'\n",
                ErrorKind::AuthenticationFailed,
            ),
            (
                "fatal: unable to access 'https://example.com/a.git/': The requested URL returned error: 403\n",
                ErrorKind::AuthenticationFailed,
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
