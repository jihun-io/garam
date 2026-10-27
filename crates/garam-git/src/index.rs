//! Staging, unstaging and discarding changes.

use std::io;
use std::path::Path;

use crate::{FileChange, Git, GitError};

/// Builds NUL-separated pathspecs for `--pathspec-from-file=- --pathspec-file-nul`,
/// which avoids command-line length limits and any quoting issues.
fn pathspec_stdin<'a>(paths: impl IntoIterator<Item = &'a str>) -> Vec<u8> {
    let mut buf = Vec::new();
    for path in paths {
        buf.extend_from_slice(path.as_bytes());
        buf.push(0);
    }
    buf
}

/// All paths a change touches (both sides of a rename).
fn touched_paths(files: &[FileChange]) -> impl Iterator<Item = &str> {
    files
        .iter()
        .flat_map(|f| std::iter::once(f.path.as_str()).chain(f.orig_path.as_deref()))
}

/// Stages the given files entirely, including deletions.
pub fn stage(git: &Git, repo: &Path, files: &[FileChange]) -> Result<(), GitError> {
    if files.is_empty() {
        return Ok(());
    }
    git.command()
        .cwd(repo)
        .args([
            "add",
            "--all",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
        ])
        .stdin(pathspec_stdin(touched_paths(files)))
        .run()?;
    Ok(())
}

/// Removes the given files from the index, keeping working tree changes.
pub fn unstage(git: &Git, repo: &Path, files: &[FileChange]) -> Result<(), GitError> {
    unstage_against(
        git,
        repo,
        files,
        &crate::diff::head_or_empty_tree(git, repo)?,
    )
}

pub(crate) fn unstage_against(
    git: &Git,
    repo: &Path,
    files: &[FileChange],
    base: &str,
) -> Result<(), GitError> {
    if files.is_empty() {
        return Ok(());
    }
    git.command()
        .cwd(repo)
        .args([
            "restore",
            "--staged",
            "--source",
            base,
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
        ])
        .stdin(pathspec_stdin(touched_paths(files)))
        .run()?;
    Ok(())
}

/// Throws away all changes (staged and unstaged) to the given files, so
/// they match HEAD again.
///
/// Before anything is reverted, every file that exists in the working tree
/// is handed to `remove`, which the app implements as "move to the system
/// trash" so the user can still recover the discarded content.
pub fn discard(
    git: &Git,
    repo: &Path,
    files: &[FileChange],
    mut remove: impl FnMut(&Path) -> io::Result<()>,
) -> Result<(), GitError> {
    if files.is_empty() {
        return Ok(());
    }
    for file in files {
        let path = repo.join(&file.path);
        if path.symlink_metadata().is_ok() {
            remove(&path)?;
        }
    }

    let (in_head, new): (Vec<&FileChange>, Vec<&FileChange>) =
        files.iter().partition(|f| f.exists_in_head());

    if !new.is_empty() {
        // Added in the index but not in HEAD: forget the index entry.
        git.command()
            .cwd(repo)
            .args([
                "rm",
                "--cached",
                "-r",
                "--quiet",
                "--ignore-unmatch",
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
            ])
            .stdin(pathspec_stdin(new.iter().map(|f| f.path.as_str())))
            .run()?;
    }
    if !in_head.is_empty() {
        let in_head: Vec<FileChange> = in_head.into_iter().cloned().collect();
        git.command()
            .cwd(repo)
            .args([
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
            ])
            .stdin(pathspec_stdin(touched_paths(&in_head)))
            .run()?;
    }
    Ok(())
}
