//! Git engine for Garam.
//!
//! Every git invocation goes through [`GitCommand`], which enforces the
//! execution rules described in `docs/ARCHITECTURE.md` (stable locale, no
//! terminal prompts, unquoted paths, ...).

pub mod blob;
pub mod branch;
mod cancel;
mod command;
pub mod commit;
pub mod commit_graph;
pub mod compare;
pub mod config;
pub mod conflict;
pub mod credential;
pub mod diff;
mod error;
mod git;
pub mod identity;
pub mod index;
pub mod log;
pub mod patch;
mod progress;
pub mod pull_request;
pub mod remote;
pub mod repo;
pub mod stash;
pub mod status;
pub mod tag;
mod version;

#[cfg(feature = "testing")]
pub mod testing;

pub use cancel::CancelToken;
pub use command::{GitCommand, GitOutput};
pub use error::{ErrorKind, GitError};
pub use git::Git;
pub use progress::{Progress, ProgressParser, ProgressPhase, TransferKind};
pub use repo::RepositoryInfo;
pub use status::{ChangeKind, FileChange, RepoStatus};
pub use version::{GitVersion, MIN_GIT_VERSION};
