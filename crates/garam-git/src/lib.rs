//! Git engine for Garam.
//!
//! Every git invocation goes through [`GitCommand`], which enforces the
//! execution rules described in `docs/ARCHITECTURE.md` (stable locale, no
//! terminal prompts, unquoted paths, ...).

mod command;
mod error;
mod git;
mod version;

#[cfg(feature = "testing")]
pub mod testing;

pub use command::{GitCommand, GitOutput};
pub use error::{ErrorKind, GitError};
pub use git::Git;
pub use version::{GitVersion, MIN_GIT_VERSION};
