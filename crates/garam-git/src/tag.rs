//! Tags.

use std::path::Path;

use crate::{Git, GitError};

/// Checks a new tag name the way git does.
pub fn validate_name(git: &Git, name: &str) -> Result<(), GitError> {
    let output = git
        .command()
        .args(["check-ref-format", &format!("refs/tags/{name}")])
        .run_unchecked()?;
    if output.success() && !name.starts_with('-') {
        Ok(())
    } else {
        Err(GitError::InvalidTagName(name.to_owned()))
    }
}

/// Tags `oid` as `name`. With a message the tag is annotated (it records
/// who tagged and when); without one it is a plain name for the commit.
pub fn create(
    git: &Git,
    repo: &Path,
    name: &str,
    oid: &str,
    message: Option<&str>,
) -> Result<(), GitError> {
    validate_name(git, name)?;
    crate::log::check_oid(oid)?;
    let mut command = git.command().cwd(repo).arg("tag");
    let message = message.map(str::trim).filter(|m| !m.is_empty());
    if let Some(message) = message {
        command = command
            .args(["--annotate", "--file=-"])
            .stdin(message.as_bytes().to_vec());
    }
    command.args([name, oid]).run()?;
    Ok(())
}
