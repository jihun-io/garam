//! Conflicts: which operation stopped, how each file conflicts, and the
//! ways to resolve, continue or abort.
//!
//! "Mine" and "theirs" are from the user's point of view. During a merge,
//! revert or cherry-pick, mine is git's "ours" (index stage 2). During a
//! rebase git swaps them: "ours" is the branch being rebased onto, and the
//! user's own commit being replayed is "theirs" (stage 3).

use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Git, GitError};

/// Files larger than this aren't scanned for conflict markers.
const MAX_MARKER_SCAN_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Merge,
    Rebase,
    Revert,
    CherryPick,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum ConflictKind {
    BothModified,
    BothAdded,
    BothDeleted,
    DeletedByMe,
    DeletedByThem,
    AddedByMe,
    AddedByThem,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    pub kind: ConflictKind,
    /// The working tree file still contains `<<<<<<<` / `>>>>>>>` lines.
    pub has_markers: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ConflictState {
    /// The operation waiting to be continued or aborted, if any. Conflicts
    /// can also exist without one, e.g. after a stash pop.
    pub operation: Option<Operation>,
    /// Files that still conflict.
    pub files: Vec<ConflictFile>,
}

/// Which version to keep for a conflicted file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Mine,
    Theirs,
}

pub fn state(git: &Git, repo: &Path) -> Result<ConflictState, GitError> {
    let operation = operation(git, repo)?;
    let rebasing = operation == Some(Operation::Rebase);
    let files = unmerged(git, repo)?
        .into_iter()
        .map(|(path, stages)| ConflictFile {
            kind: conflict_kind(&stages, rebasing),
            has_markers: has_markers(&repo.join(&path)),
            path,
        })
        .collect();
    Ok(ConflictState { operation, files })
}

fn git_dir(git: &Git, repo: &Path) -> Result<PathBuf, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--absolute-git-dir"])
        .run()?;
    Ok(PathBuf::from(output.stdout_str().trim()))
}

fn operation(git: &Git, repo: &Path) -> Result<Option<Operation>, GitError> {
    let dir = git_dir(git, repo)?;
    // `rebase-apply` with an `applying` file belongs to `git am`, which
    // Garam doesn't drive.
    let rebasing = dir.join("rebase-merge").is_dir()
        || (dir.join("rebase-apply").is_dir() && !dir.join("rebase-apply/applying").exists());
    Ok(if rebasing {
        Some(Operation::Rebase)
    } else if dir.join("MERGE_HEAD").is_file() {
        Some(Operation::Merge)
    } else if dir.join("REVERT_HEAD").is_file() {
        Some(Operation::Revert)
    } else if dir.join("CHERRY_PICK_HEAD").is_file() {
        Some(Operation::CherryPick)
    } else {
        None
    })
}

/// Unmerged paths with the index stages (1 base, 2 ours, 3 theirs) each has.
pub(crate) fn unmerged(git: &Git, repo: &Path) -> Result<BTreeMap<String, Vec<u8>>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["ls-files", "--unmerged", "-z"])
        .run()?;
    let mut files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    // Records look like "<mode> <oid> <stage>\t<path>".
    for record in output.stdout_str().split('\0') {
        let Some((info, path)) = record.split_once('\t') else {
            continue;
        };
        let Some(stage) = info.rsplit(' ').next().and_then(|s| s.parse::<u8>().ok()) else {
            continue;
        };
        files.entry(path.to_owned()).or_default().push(stage);
    }
    Ok(files)
}

/// The index stage holding the user's version or the other side's.
fn stage_of(side: Side, rebasing: bool) -> u8 {
    match (side, rebasing) {
        (Side::Mine, false) | (Side::Theirs, true) => 2,
        (Side::Theirs, false) | (Side::Mine, true) => 3,
    }
}

fn conflict_kind(stages: &[u8], rebasing: bool) -> ConflictKind {
    let base = stages.contains(&1);
    let mine = stages.contains(&stage_of(Side::Mine, rebasing));
    let theirs = stages.contains(&stage_of(Side::Theirs, rebasing));
    match (base, mine, theirs) {
        (true, true, true) => ConflictKind::BothModified,
        (false, true, true) => ConflictKind::BothAdded,
        (true, false, true) => ConflictKind::DeletedByMe,
        (true, true, false) => ConflictKind::DeletedByThem,
        (false, true, false) => ConflictKind::AddedByMe,
        (false, false, true) => ConflictKind::AddedByThem,
        _ => ConflictKind::BothDeleted,
    }
}

fn has_markers(path: &Path) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    if file
        .metadata()
        .is_ok_and(|m| !m.is_file() || m.len() > MAX_MARKER_SCAN_BYTES)
    {
        return false;
    }
    let mut start = false;
    for line in BufReader::new(file).split(b'\n').map_while(Result::ok) {
        if line.starts_with(b"<<<<<<< ") || line == b"<<<<<<<" {
            start = true;
        } else if start && (line.starts_with(b">>>>>>> ") || line == b">>>>>>>") {
            return true;
        }
    }
    false
}

/// Keeps one side's version of a conflicted file. If that side deleted
/// the file, it is deleted.
pub fn resolve(git: &Git, repo: &Path, path: &str, side: Side) -> Result<(), GitError> {
    let rebasing = operation(git, repo)? == Some(Operation::Rebase);
    let stages = unmerged(git, repo)?
        .remove(path)
        .ok_or_else(|| GitError::Parse(format!("not conflicted: {path}")))?;
    let stage = stage_of(side, rebasing);
    if stages.contains(&stage) {
        let flag = if stage == 2 { "--ours" } else { "--theirs" };
        git.command()
            .cwd(repo)
            .args(["checkout", flag])
            .paths([path])
            .run()?;
        git.command().cwd(repo).arg("add").paths([path]).run()?;
    } else {
        git.command()
            .cwd(repo)
            .args(["rm", "--quiet"])
            .paths([path])
            .run()?;
    }
    Ok(())
}

/// Marks a file resolved as it is in the working tree (edited by hand, or
/// deleted).
pub fn mark_resolved(git: &Git, repo: &Path, path: &str) -> Result<(), GitError> {
    git.command()
        .cwd(repo)
        .args(["add", "--all"])
        .paths([path])
        .run()?;
    Ok(())
}

/// Finishes the stopped operation once every conflict is resolved. A
/// rebase may stop again at a later commit with
/// [`crate::ErrorKind::RebaseConflict`].
pub fn continue_operation(git: &Git, repo: &Path) -> Result<(), GitError> {
    let operation = operation(git, repo)?.ok_or(GitError::NothingInProgress)?;
    if !unmerged(git, repo)?.is_empty() {
        return Err(GitError::ConflictsRemain);
    }
    // Keep git's prepared message instead of opening an editor.
    let command = git.command().cwd(repo).env("GIT_EDITOR", "true");
    let command = match operation {
        Operation::Merge => command.args(["commit", "--no-edit"]),
        Operation::Rebase => command.args(["rebase", "--continue"]),
        Operation::Revert => command.args(["revert", "--continue"]),
        Operation::CherryPick => command.args(["cherry-pick", "--continue"]),
    };
    command.run()?;
    Ok(())
}

/// Stops the operation and returns to the state before it started.
pub fn abort(git: &Git, repo: &Path) -> Result<(), GitError> {
    let operation = operation(git, repo)?.ok_or(GitError::NothingInProgress)?;
    let command = match operation {
        Operation::Merge => "merge",
        Operation::Rebase => "rebase",
        Operation::Revert => "revert",
        Operation::CherryPick => "cherry-pick",
    };
    git.command().cwd(repo).args([command, "--abort"]).run()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_conflicts_from_the_users_side() {
        assert_eq!(conflict_kind(&[1, 2, 3], false), ConflictKind::BothModified);
        assert_eq!(conflict_kind(&[2, 3], false), ConflictKind::BothAdded);
        assert_eq!(conflict_kind(&[1], false), ConflictKind::BothDeleted);
        assert_eq!(conflict_kind(&[1, 3], false), ConflictKind::DeletedByMe);
        assert_eq!(conflict_kind(&[1, 2], false), ConflictKind::DeletedByThem);
        assert_eq!(conflict_kind(&[2], false), ConflictKind::AddedByMe);
        // Rebases swap the stages.
        assert_eq!(conflict_kind(&[1, 3], true), ConflictKind::DeletedByThem);
        assert_eq!(conflict_kind(&[3], true), ConflictKind::AddedByMe);
    }

    #[test]
    fn finds_conflict_markers() {
        let dir = tempfile_dir();
        let path = dir.join("a.txt");
        fs::write(
            &path,
            "x\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> topic\n",
        )
        .unwrap();
        assert!(has_markers(&path));
        fs::write(&path, "x\n<<<<<<< not closed\n").unwrap();
        assert!(!has_markers(&path));
        fs::write(&path, "resolved\n").unwrap();
        assert!(!has_markers(&path));
        assert!(!has_markers(&dir.join("missing.txt")));
        let _ = fs::remove_dir_all(dir);
    }

    fn tempfile_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "garam-conflict-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
