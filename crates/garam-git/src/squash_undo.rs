//! Durable, worktree-local recovery for the last completed squash. Journal
//! commits live under private refs, retaining both histories through Git GC.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Git, GitError, conflict, log};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Record {
    branch: String,
    before: String,
    after: Option<String>,
    count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SquashUndo {
    /// Immutable journal id: a stale notice cannot undo a newer squash.
    pub id: String,
    pub branch: String,
    pub before: String,
    pub after: String,
    pub count: u32,
    pub available: bool,
    pub content_changed: bool,
}

struct Refs {
    pending: String,
    latest: String,
}

fn refs(git: &Git, repo: &Path) -> Result<Refs, GitError> {
    let dir = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--absolute-git-dir"])
        .run()?;
    let dir = dunce::canonicalize(dir.stdout_str().trim())?;
    let key = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["hash-object", "--stdin"])
        .stdin(dir.to_string_lossy().as_bytes())
        .run()?;
    let key = key.stdout_str().trim().to_owned();
    Ok(Refs {
        pending: format!("refs/garam/squash-undo/{key}/pending"),
        latest: format!("refs/garam/squash-undo/{key}/latest"),
    })
}

fn oid(git: &Git, repo: &Path, name: &str) -> Result<Option<String>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--verify", "--quiet", name])
        .run_unchecked()?;
    if output.code == Some(1) {
        return Ok(None);
    }
    if !output.success() {
        return Err(GitError::failed(output.code, output.failure_text()));
    }
    Ok(Some(output.stdout_str().trim().to_owned()))
}

fn branch(git: &Git, repo: &Path) -> Result<Option<String>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["symbolic-ref", "--quiet", "HEAD"])
        .run_unchecked()?;
    if output.code == Some(1) {
        return Ok(None);
    }
    if !output.success() {
        return Err(GitError::failed(output.code, output.failure_text()));
    }
    Ok(output
        .stdout_str()
        .trim()
        .strip_prefix("refs/heads/")
        .map(str::to_owned))
}

fn read(git: &Git, repo: &Path, name: &str) -> Result<Option<(String, Record)>, GitError> {
    let Some(id) = oid(git, repo, name)? else {
        return Ok(None);
    };
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "show",
            "--no-notes",
            "--no-show-signature",
            "-s",
            "--format=%B",
            &id,
            "--",
        ])
        .run()?;
    let record: Record =
        serde_json::from_slice(&output.stdout).map_err(|e| GitError::Parse(e.to_string()))?;
    let valid_oid = |value: &str| {
        matches!(value.len(), 40 | 64) && value.bytes().all(|b| b.is_ascii_hexdigit())
    };
    if !valid_oid(&record.before) || record.after.as_deref().is_some_and(|s| !valid_oid(s)) {
        return Err(GitError::SquashUndoUnavailable);
    }
    // All later commands use this name as a full ref, never as an option.
    crate::branch::validate_name(git, &record.branch)?;
    Ok(Some((id, record)))
}

fn write(git: &Git, repo: &Path, record: &Record) -> Result<String, GitError> {
    let message = serde_json::to_vec(record).map_err(|e| GitError::Parse(e.to_string()))?;
    let mut command = git
        .command()
        .cwd(repo)
        .arg("commit-tree")
        .arg(format!("{}^{{tree}}", record.before))
        .args(["-p", &record.before]);
    if let Some(after) = &record.after {
        command = command.args(["-p", after]);
    }
    let output = command.args(["-F", "-"]).stdin(message).run()?;
    Ok(output.stdout_str().trim().to_owned())
}

fn discard_pending(git: &Git, repo: &Path, refs: &Refs, id: &str) -> Result<(), GitError> {
    git.command()
        .cwd(repo)
        .args(["update-ref", "-d", &refs.pending, id])
        .run()?;
    Ok(())
}

fn complete(
    git: &Git,
    repo: &Path,
    refs: &Refs,
    id: &str,
    mut record: Record,
    after: String,
) -> Result<(), GitError> {
    if after == record.before {
        return discard_pending(git, repo, refs, id);
    }
    record.after = Some(after);
    let new = write(git, repo, &record)?;
    let old = oid(git, repo, &refs.latest)?.unwrap_or_else(|| "0".repeat(new.len()));
    // Archive every completed squash, including its eventual conflict result.
    // These refs are excluded from normal history/branch lists and pushes.
    let transaction = format!(
        "start\nupdate refs/garam/squash-backups/{new} {new}\nupdate {} {new} {old}\ndelete {} {id}\nprepare\ncommit\n",
        refs.latest, refs.pending
    );
    git.command()
        .cwd(repo)
        .args(["update-ref", "--stdin"])
        .stdin(transaction.into_bytes())
        .run()?;
    Ok(())
}

/// Reconciles a squash that stopped in rebase. This also handles finishing
/// from a terminal or restarting the app during conflict resolution.
pub fn finish_pending(git: &Git, repo: &Path) -> Result<(), GitError> {
    let refs = refs(git, repo)?;
    let Some((id, record)) = read(git, repo, &refs.pending)? else {
        return Ok(());
    };
    if conflict::state(git, repo)?.operation.is_some() {
        return Ok(());
    }
    let full_branch = format!("refs/heads/{}", record.branch);
    let Some(after) = oid(git, repo, &full_branch)? else {
        return discard_pending(git, repo, &refs, &id);
    };
    if after == record.before {
        return discard_pending(git, repo, &refs, &id);
    }
    // Do not attribute a later commit/reset/checkout to the pending squash.
    // A successful rebase updates its branch exactly once, from `before`.
    let entries = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "reflog",
            "show",
            "-2",
            "--format=%H%x00%gs",
            &full_branch,
            "--",
        ])
        .run()?;
    let entries = entries.stdout_str();
    let mut entries = entries.lines();
    let latest = entries.next().and_then(|s| s.split_once('\0'));
    let previous = entries.next().and_then(|s| s.split_once('\0'));
    if latest.is_some_and(|(head, action)| head == after && action.starts_with("rebase (finish)"))
        && previous.is_some_and(|(head, _)| head == record.before)
    {
        complete(git, repo, &refs, &id, record, after)
    } else {
        discard_pending(git, repo, &refs, &id)
    }
}

/// Runs a squash with a durable backup in place before any ref moves.
/// Failed validation leaves the previous successful squash undoable.
pub(crate) fn track<T>(
    git: &Git,
    repo: &Path,
    count: usize,
    run: impl FnOnce() -> Result<T, GitError>,
) -> Result<T, GitError> {
    finish_pending(git, repo)?;
    if conflict::state(git, repo)?.operation.is_some() {
        return Err(GitError::CannotSquash);
    }
    let refs = refs(git, repo)?;
    let record = Record {
        branch: branch(git, repo)?.ok_or(GitError::DetachedHead)?,
        before: crate::commit::head_oid(git, repo)?.ok_or(GitError::CannotSquash)?,
        after: None,
        count: u32::try_from(count).map_err(|_| GitError::CannotSquash)?,
    };
    let id = write(git, repo, &record)?;
    git.command()
        .cwd(repo)
        .args(["update-ref", &refs.pending, &id, &"0".repeat(id.len())])
        .run()?;
    let result = run();
    if result.is_ok() {
        let after =
            oid(git, repo, &format!("refs/heads/{}", record.branch))?.ok_or(GitError::HeadMoved)?;
        complete(git, repo, &refs, &id, record, after)?;
    } else if conflict::state(git, repo)?.operation != Some(conflict::Operation::Rebase) {
        discard_pending(git, repo, &refs, &id)?;
    }
    result
}

pub fn preview(git: &Git, repo: &Path) -> Result<Option<SquashUndo>, GitError> {
    finish_pending(git, repo)?;
    let refs = refs(git, repo)?;
    let Some((id, record)) = read(git, repo, &refs.latest)? else {
        return Ok(None);
    };
    let Some(after) = record.after else {
        return Err(GitError::SquashUndoUnavailable);
    };
    let available = branch(git, repo)?.as_deref() == Some(&record.branch)
        && crate::commit::head_oid(git, repo)?.as_deref() == Some(&after)
        && conflict::state(git, repo)?.operation.is_none();
    let before_tree = oid(git, repo, &format!("{}^{{tree}}", record.before))?;
    let after_tree = oid(git, repo, &format!("{after}^{{tree}}"))?;
    Ok(Some(SquashUndo {
        id,
        branch: record.branch,
        before: record.before,
        after,
        count: record.count,
        available,
        content_changed: before_tree != after_tree,
    }))
}

/// Restores the original history only while the recorded result is HEAD.
/// A soft move preserves the index; --keep checks files before restoring
/// a different tree, protecting untracked files as well as tracked edits.
pub fn undo(git: &Git, repo: &Path, expected_id: &str) -> Result<SquashUndo, GitError> {
    let record = preview(git, repo)?.ok_or(GitError::SquashUndoUnavailable)?;
    if record.id != expected_id {
        return Err(GitError::SquashUndoUnavailable);
    }
    if !record.available {
        return Err(GitError::HeadMoved);
    }
    let state = conflict::state(git, repo)?;
    if state.operation.is_some() || !state.files.is_empty() {
        return Err(GitError::CannotSquash);
    }
    if log::has_tracked_changes(git, repo)? {
        return Err(GitError::UncommittedChanges);
    }
    // Recheck after the file inspection, then let Git acquire its own locks.
    if branch(git, repo)?.as_deref() != Some(&record.branch)
        || crate::commit::head_oid(git, repo)?.as_deref() != Some(&record.after)
    {
        return Err(GitError::HeadMoved);
    }
    if record.content_changed {
        protect_local_files(git, repo, &record)?;
        git.command()
            .cwd(repo)
            .args(["reset", "--keep", &record.before])
            .run()?;
    } else {
        git.command()
            .cwd(repo)
            .args([
                "update-ref",
                "-m",
                "undo squash: restore original commits",
                &format!("refs/heads/{}", record.branch),
                &record.before,
                &record.after,
            ])
            .run()?;
    }
    let refs = refs(git, repo)?;
    git.command()
        .cwd(repo)
        .args(["update-ref", "-d", &refs.latest, &record.id])
        .run()?;
    Ok(record)
}

/// `reset --keep` permits overwriting ignored files. Inspect newly restored
/// paths and their ancestors too, including directories and symlinks.
fn protect_local_files(git: &Git, repo: &Path, record: &SquashUndo) -> Result<(), GitError> {
    let added = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "diff",
            "--name-only",
            "--no-renames",
            "--diff-filter=A",
            "-z",
            &record.after,
            &record.before,
            "--",
        ])
        .run()?;
    let mut blocked = vec![];
    for path in added.stdout_str().split('\0').filter(|s| !s.is_empty()) {
        let full = repo.join(path);
        let mut current = Some(full.as_path());
        let mut leaf = true;
        while let Some(candidate) = current.filter(|p| *p != repo) {
            match std::fs::symlink_metadata(candidate) {
                Ok(meta) if leaf || !meta.is_dir() => {
                    blocked.push(path.to_owned());
                    break;
                }
                Ok(_) => {}
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                    ) => {}
                Err(e) => return Err(e.into()),
            }
            leaf = false;
            current = candidate.parent();
        }
    }
    if !blocked.is_empty() {
        return Err(GitError::SquashUndoLocalFiles(blocked));
    }
    Ok(())
}
