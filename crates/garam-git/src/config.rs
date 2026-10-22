//! The user's global git settings that Garam's settings screen edits.
//!
//! These live in git's own config (`~/.gitconfig`), not in Garam's
//! settings, so the command line sees the same values.

use serde::{Deserialize, Serialize};

use crate::{Git, GitError, branch};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum GlobalKey {
    /// `user.name`
    UserName,
    /// `user.email`
    UserEmail,
    /// `init.defaultBranch`
    DefaultBranch,
}

impl GlobalKey {
    fn name(self) -> &'static str {
        match self {
            Self::UserName => "user.name",
            Self::UserEmail => "user.email",
            Self::DefaultBranch => "init.defaultBranch",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GlobalSettings {
    pub user_name: Option<String>,
    pub user_email: Option<String>,
    pub default_branch: Option<String>,
}

pub fn global_settings(git: &Git) -> Result<GlobalSettings, GitError> {
    Ok(GlobalSettings {
        user_name: get(git, GlobalKey::UserName)?,
        user_email: get(git, GlobalKey::UserEmail)?,
        default_branch: get(git, GlobalKey::DefaultBranch)?,
    })
}

fn get(git: &Git, key: GlobalKey) -> Result<Option<String>, GitError> {
    let output = git
        .command()
        .args(["config", "--global", "--get", key.name()])
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

/// Sets `key` globally, or removes it when `value` is empty. A default
/// branch name must be a valid branch name.
pub fn set(git: &Git, key: GlobalKey, value: &str) -> Result<(), GitError> {
    let value = value.trim();
    if value.is_empty() {
        // Exit code 5 means it wasn't set, which is fine.
        let output = git
            .command()
            .args(["config", "--global", "--unset-all", key.name()])
            .run_unchecked()?;
        if !output.success() && output.code != Some(5) {
            return Err(GitError::failed(output.code, output.failure_text()));
        }
        return Ok(());
    }
    if key == GlobalKey::DefaultBranch {
        branch::validate_name(git, value)?;
    }
    git.command()
        .args(["config", "--global", key.name(), value])
        .run()?;
    Ok(())
}
