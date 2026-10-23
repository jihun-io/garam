//! Tags.
//!
//! Tags made here are remembered as unpushed until a push sends them or
//! they are deleted, so a push can carry them along. Fetched tags look the
//! same as local ones in `refs/tags`, so without that list there is no way
//! to tell which tags the remote lacks short of asking it.

use std::fs;
use std::io::ErrorKind as IoErrorKind;
use std::path::{Path, PathBuf};

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
    let mut names = read_unpushed(git, repo)?;
    names.push(name.to_owned());
    write_unpushed(git, repo, &names)
}

/// Deletes the tag `name` from this repository only.
pub fn delete(git: &Git, repo: &Path, name: &str) -> Result<(), GitError> {
    git.command()
        .cwd(repo)
        .args(["tag", "--delete", "--", name])
        .run()?;
    forget(git, repo, &[name.to_owned()])
}

/// Tags made here that no push has sent yet, oldest first. Tags deleted
/// outside the app drop out.
pub fn unpushed(git: &Git, repo: &Path) -> Result<Vec<String>, GitError> {
    let names = read_unpushed(git, repo)?;
    if names.is_empty() {
        return Ok(names);
    }
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["for-each-ref", "--format=%(refname:lstrip=2)", "refs/tags"])
        .run()?;
    let stdout = output.stdout_str();
    let existing: Vec<&str> = stdout.lines().collect();
    Ok(names
        .into_iter()
        .filter(|name| existing.contains(&name.as_str()))
        .collect())
}

/// Takes `names` off the unpushed list (they were pushed or deleted).
pub fn forget(git: &Git, repo: &Path, names: &[String]) -> Result<(), GitError> {
    let mut list = read_unpushed(git, repo)?;
    let before = list.len();
    list.retain(|name| !names.contains(name));
    if list.len() == before {
        return Ok(());
    }
    write_unpushed(git, repo, &list)
}

/// `.git/garam/unpushed-tags`, in the main repository's git directory so
/// worktrees share it like they share tags.
fn unpushed_file(git: &Git, repo: &Path) -> Result<PathBuf, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--git-common-dir"])
        .run()?;
    let dir = PathBuf::from(output.stdout_str().trim());
    let dir = if dir.is_absolute() {
        dir
    } else {
        repo.join(dir)
    };
    Ok(dir.join("garam").join("unpushed-tags"))
}

fn read_unpushed(git: &Git, repo: &Path) -> Result<Vec<String>, GitError> {
    match fs::read_to_string(unpushed_file(git, repo)?) {
        Ok(text) => {
            let mut names: Vec<String> = Vec::new();
            for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
                if !names.iter().any(|n| n == line) {
                    names.push(line.to_owned());
                }
            }
            Ok(names)
        }
        Err(e) if e.kind() == IoErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

fn write_unpushed(git: &Git, repo: &Path, names: &[String]) -> Result<(), GitError> {
    let file = unpushed_file(git, repo)?;
    if names.is_empty() {
        return match fs::remove_file(&file) {
            Err(e) if e.kind() != IoErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        };
    }
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut text = names.join("\n");
    text.push('\n');
    // Write a sibling and rename it so a crash never leaves half a list.
    let temp = file.with_extension("tmp");
    fs::write(&temp, text)?;
    fs::rename(&temp, &file)?;
    Ok(())
}
