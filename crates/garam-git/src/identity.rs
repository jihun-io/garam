//! The commit author identity (`user.name` / `user.email`).
//!
//! A repository can override the user's global identity in its own config
//! (`.git/config`), e.g. a personal project on a work machine. Garam writes
//! the override there, not in its own settings, so commits made from the
//! command line use the same author.

use std::path::Path;

use serde::Serialize;

use crate::{Git, GitError};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Identity {
    pub name: Option<String>,
    pub email: Option<String>,
}

impl Identity {
    pub fn is_complete(&self) -> bool {
        self.name.is_some() && self.email.is_some()
    }
}

/// Where a repository's identity comes from.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RepoIdentity {
    /// What git uses for commits in the repository.
    pub effective: Identity,
    /// Values set in the repository's own config, which win over the rest.
    pub local: Identity,
    /// What git would use without the repository's own values (global,
    /// system or included config).
    pub inherited: Identity,
}

impl RepoIdentity {
    /// Whether the repository sets any part of the identity itself.
    pub fn is_overridden(&self) -> bool {
        self.local.name.is_some() || self.local.email.is_some()
    }
}

/// The identity git would use in `repo` and where each part comes from.
pub fn get(git: &Git, repo: &Path) -> Result<RepoIdentity, GitError> {
    let name = scoped_values(git, repo, "user.name")?;
    let email = scoped_values(git, repo, "user.email")?;
    Ok(RepoIdentity {
        effective: Identity {
            name: name.effective,
            email: email.effective,
        },
        local: Identity {
            name: name.local,
            email: email.local,
        },
        inherited: Identity {
            name: name.inherited,
            email: email.inherited,
        },
    })
}

/// Saves the identity in the user's global git config.
pub fn set_global(git: &Git, name: &str, email: &str) -> Result<(), GitError> {
    for (key, value) in [("user.name", name.trim()), ("user.email", email.trim())] {
        git.command()
            .args(["config", "--global", key, value])
            .run()?;
    }
    Ok(())
}

/// Saves the identity in `repo`'s own config, overriding the global one.
pub fn set_local(git: &Git, repo: &Path, name: &str, email: &str) -> Result<(), GitError> {
    for (key, value) in [("user.name", name.trim()), ("user.email", email.trim())] {
        git.command()
            .cwd(repo)
            .args(["config", "--local", key, value])
            .run()?;
    }
    Ok(())
}

/// Removes `repo`'s own identity so the global one applies again.
pub fn clear_local(git: &Git, repo: &Path) -> Result<(), GitError> {
    for key in ["user.name", "user.email"] {
        let output = git
            .command()
            .cwd(repo)
            .args(["config", "--local", "--unset-all", key])
            .run_unchecked()?;
        // 5 = wasn't set.
        if !output.success() && output.code != Some(5) {
            return Err(GitError::failed(output.code, output.failure_text()));
        }
    }
    Ok(())
}

#[derive(Default)]
struct ScopedValues {
    effective: Option<String>,
    local: Option<String>,
    inherited: Option<String>,
}

/// Every value of `key` with its scope, in the order git reads them; the
/// last one wins.
fn scoped_values(git: &Git, repo: &Path, key: &str) -> Result<ScopedValues, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["config", "-z", "--show-scope", "--get-all", key])
        .run_unchecked()?;
    match output.code {
        Some(0) => {}
        // 1 = not set.
        Some(1) => return Ok(ScopedValues::default()),
        _ => return Err(GitError::failed(output.code, output.failure_text())),
    }

    let mut values = ScopedValues::default();
    // `scope\0value\0` pairs.
    let text = output.stdout_str();
    let mut parts = text.split('\0');
    while let (Some(scope), Some(value)) = (parts.next(), parts.next()) {
        let value = value.trim();
        let value = (!value.is_empty()).then(|| value.to_owned());
        match scope {
            "local" | "worktree" => values.local = value.clone(),
            // A one-off `-c` override isn't part of the repository's setup.
            "command" => {}
            _ => values.inherited = value.clone(),
        }
        values.effective = value;
    }
    Ok(values)
}
