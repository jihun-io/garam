//! Opening, creating and cloning repositories.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{CancelToken, Git, GitError, Progress, ProgressParser};

/// A repository's working tree as Garam tracks it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RepositoryInfo {
    /// Canonical path of the working tree's top-level directory.
    pub path: String,
    /// Display name: the top-level directory's name.
    pub name: String,
}

impl RepositoryInfo {
    fn from_toplevel(toplevel: &Path) -> Result<Self, GitError> {
        let path = dunce::canonicalize(toplevel)?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        Ok(Self {
            path: path.display().to_string(),
            name,
        })
    }
}

/// Resolves `path` (which may be any directory inside a work tree) to its
/// repository.
pub fn open(git: &Git, path: &Path) -> Result<RepositoryInfo, GitError> {
    if !path.is_dir() {
        return Err(GitError::PathNotFound(path.to_path_buf()));
    }
    let rev_parse = |flag: &str| {
        git.command()
            .cwd(path)
            .read_only()
            .args(["rev-parse", flag])
            .run()
            .map(|o| o.stdout_str().trim().to_owned())
    };

    if rev_parse("--is-bare-repository")? == "true" {
        return Err(GitError::BareRepository(path.to_path_buf()));
    }
    // Fails inside `.git` itself, where there is no work tree.
    let toplevel = rev_parse("--show-toplevel")
        .ok()
        .filter(|t| !t.is_empty())
        .ok_or_else(|| GitError::NotARepository(path.to_path_buf()))?;
    RepositoryInfo::from_toplevel(Path::new(&toplevel))
}

/// Creates `path` if needed and runs `git init` in it.
///
/// Uses the user's `init.defaultBranch` if set, otherwise `main`.
pub fn init(git: &Git, path: &Path) -> Result<RepositoryInfo, GitError> {
    fs::create_dir_all(path)?;
    let mut command = git.command().cwd(path).arg("init").arg("--quiet");
    if default_branch_config(git)?.is_none() {
        command = command.arg("--initial-branch=main");
    }
    command.run()?;
    RepositoryInfo::from_toplevel(path)
}

fn default_branch_config(git: &Git) -> Result<Option<String>, GitError> {
    // Exit code 1 means "not set", which is an answer rather than an error.
    let output = git
        .command()
        .args(["config", "--global", "--get", "init.defaultBranch"])
        .run_unchecked()?;
    let value = output.stdout_str().trim().to_owned();
    Ok((output.success() && !value.is_empty()).then_some(value))
}

/// Clones `url` into `dest`, reporting progress.
///
/// `dest` must not exist or be an empty directory. If the clone fails or is
/// cancelled, whatever was written to `dest` is removed again.
pub fn clone(
    git: &Git,
    url: &str,
    dest: &Path,
    cancel: &CancelToken,
    mut on_progress: impl FnMut(Progress),
) -> Result<RepositoryInfo, GitError> {
    let existed = dest.exists();
    if existed && !is_empty_dir(dest)? {
        return Err(GitError::DestinationNotEmpty(dest.to_path_buf()));
    }

    let mut parser = ProgressParser::new();
    let result = git
        .command()
        .args(["clone", "--progress", "--"])
        .arg(url)
        .arg(dest)
        .run_streaming(cancel, |line| {
            if let Some(progress) = parser.feed(line) {
                on_progress(progress);
            }
        });

    match result {
        Ok(_) => RepositoryInfo::from_toplevel(dest),
        Err(err) => {
            cleanup_failed_clone(dest, existed);
            Err(err)
        }
    }
}

fn is_empty_dir(path: &Path) -> Result<bool, GitError> {
    if !path.is_dir() {
        return Ok(false);
    }
    Ok(fs::read_dir(path)?.next().is_none())
}

/// Removes a partial clone. Only called after we verified `dest` was absent
/// or empty before cloning, so nothing of the user's is deleted.
fn cleanup_failed_clone(dest: &Path, existed: bool) {
    if existed {
        if let Ok(entries) = fs::read_dir(dest) {
            for entry in entries.flatten() {
                let path: PathBuf = entry.path();
                let _ = if path.is_dir() {
                    fs::remove_dir_all(&path)
                } else {
                    fs::remove_file(&path)
                };
            }
        }
    } else {
        let _ = fs::remove_dir_all(dest);
    }
}
