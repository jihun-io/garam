//! The commit author identity (`user.name` / `user.email`).

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

/// The identity git would use in `repo` (repository config wins over global).
pub fn get(git: &Git, repo: &Path) -> Result<Identity, GitError> {
    Ok(Identity {
        name: config_value(git, repo, "user.name")?,
        email: config_value(git, repo, "user.email")?,
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

fn config_value(git: &Git, repo: &Path, key: &str) -> Result<Option<String>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["config", "--get", key])
        .run_unchecked()?;
    match output.code {
        Some(0) => {
            let value = output.stdout_str().trim().to_owned();
            Ok((!value.is_empty()).then_some(value))
        }
        // 1 = not set.
        Some(1) => Ok(None),
        _ => Err(GitError::failed(output.code, output.failure_text())),
    }
}
