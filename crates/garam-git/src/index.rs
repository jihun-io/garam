//! Staging, unstaging and discarding changes.

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};

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
/// is handed to `remove` in a single call, which the app implements as
/// "move to the system trash" so the user can still recover the discarded
/// content. Handing over all paths at once lets the remover batch them, and
/// a directory holding nothing but discarded files is handed over as the
/// directory itself: trashing thousands of files one by one is very slow on
/// some platforms and scatters them across the trash.
pub fn discard(
    git: &Git,
    repo: &Path,
    files: &[FileChange],
    remove: impl FnOnce(&[PathBuf]) -> io::Result<()>,
) -> Result<(), GitError> {
    if files.is_empty() {
        return Ok(());
    }
    let existing: Vec<PathBuf> = files
        .iter()
        .map(|file| PathBuf::from(file.path.trim_end_matches('/')))
        .filter(|path| repo.join(path).symlink_metadata().is_ok())
        .collect();
    if !existing.is_empty() {
        let roots: Vec<PathBuf> = removal_roots(repo, &existing)
            .into_iter()
            .map(|path| repo.join(path))
            .collect();
        remove(&roots)?;
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

/// The fewest repo-relative paths whose removal removes exactly `paths`.
///
/// A directory replaces its contents only when everything inside it on disk
/// is one of `paths` (or an empty directory), so files that aren't being
/// discarded, like tracked or ignored ones, are never swept along. Only
/// directories that contain one of `paths` are read.
fn removal_roots(repo: &Path, paths: &[PathBuf]) -> Vec<PathBuf> {
    let selected: HashSet<&Path> = paths.iter().map(PathBuf::as_path).collect();
    let containing: HashSet<&Path> = paths
        .iter()
        .flat_map(|p| p.ancestors().skip(1))
        .filter(|p| !p.as_os_str().is_empty())
        .collect();

    let mut covered = HashSet::new();
    for dir in &containing {
        if dir.parent() == Some(Path::new("")) {
            mark_covered(repo, dir, &selected, &containing, &mut covered);
        }
    }

    // Keep the outermost covered directories, and every selected path that
    // isn't inside one of them.
    let inside_covered = |p: &Path| p.ancestors().skip(1).any(|a| covered.contains(a));
    let mut roots: Vec<PathBuf> = covered
        .iter()
        .filter(|dir| !inside_covered(dir))
        .cloned()
        .chain(paths.iter().filter(|p| !inside_covered(p)).cloned())
        .collect();
    roots.sort();
    roots
}

/// Returns whether everything inside `dir` is selected, a covered directory
/// or an empty directory, and records each such directory in `covered`.
fn mark_covered(
    repo: &Path,
    dir: &Path,
    selected: &HashSet<&Path>,
    containing: &HashSet<&Path>,
    covered: &mut HashSet<PathBuf>,
) -> bool {
    let Ok(entries) = std::fs::read_dir(repo.join(dir)) else {
        return false;
    };
    let mut all = true;
    for entry in entries {
        let Ok(entry) = entry else {
            all = false;
            continue;
        };
        let path = dir.join(entry.file_name());
        let ok = if selected.contains(path.as_path()) {
            true
        } else if containing.contains(path.as_path()) {
            mark_covered(repo, &path, selected, containing, covered)
        } else {
            is_empty_dir(&entry)
        };
        all &= ok;
    }
    if all {
        covered.insert(dir.to_path_buf());
    }
    all
}

fn is_empty_dir(entry: &std::fs::DirEntry) -> bool {
    entry.file_type().is_ok_and(|t| t.is_dir())
        && std::fs::read_dir(entry.path()).is_ok_and(|mut d| d.next().is_none())
}
