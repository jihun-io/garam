//! Stashes: changes put aside to come back to later.
//!
//! Stashes are named by their commit id rather than `stash@{n}`, whose
//! number shifts whenever another stash is added or dropped; the current
//! `stash@{n}` is looked up right before each git call.
//!
//! A stash is a merge commit: its first parent is the commit the changes
//! were stashed on, its tree the working tree then, its second parent the
//! index, and a third parent, when there is one, holds the untracked files.

use std::path::Path;

use serde::Serialize;

use crate::log::{CommitFile, check_oid, diff_between, parse_name_status};
use crate::status::ChangeKind;
use crate::{Git, GitError, diff};

/// Marker in stash messages created by Garam when leaving a branch,
/// followed by the branch name.
pub(crate) const AUTO_STASH_PREFIX: &str = "garam-auto-stash:";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    /// Commit id; stable while `stash@{n}` shifts.
    pub oid: String,
    /// The commit the changes were stashed on.
    pub base: String,
    /// `stash@{0}` when listed.
    pub name: String,
    /// The branch it was stashed on; none on a detached HEAD.
    pub branch: Option<String>,
    /// What the user wrote; none when git made up a "WIP on" message.
    pub message: Option<String>,
    /// Made by Garam when switching away from `branch`.
    pub auto: bool,
    pub has_untracked: bool,
    /// Seconds since the Unix epoch.
    pub created_at: u32,
}

/// Every stash, newest first.
pub fn list(git: &Git, repo: &Path) -> Result<Vec<Stash>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "stash",
            "list",
            "-z",
            "--format=%H%x1f%P%x1f%gd%x1f%ct%x1f%gs",
        ])
        .run()?;
    let mut stashes: Vec<Stash> = output
        .stdout_str()
        .split('\0')
        .filter_map(parse_entry)
        .collect();
    mark_empty_untracked(git, repo, &mut stashes)?;
    Ok(stashes)
}

/// `--include-untracked` adds the third parent even when there were no
/// untracked files; such a parent has an empty tree.
fn mark_empty_untracked(git: &Git, repo: &Path, stashes: &mut [Stash]) -> Result<(), GitError> {
    let revs: Vec<String> = stashes
        .iter()
        .filter(|s| s.has_untracked)
        .map(|s| format!("{}^3^{{tree}}", s.oid))
        .collect();
    if revs.is_empty() {
        return Ok(());
    }
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .arg("rev-parse")
        .args(&revs)
        .run()?;
    let empty = diff::empty_tree(git, repo)?;
    let stdout = output.stdout_str();
    let mut trees = stdout.lines().map(str::trim);
    for stash in stashes.iter_mut().filter(|s| s.has_untracked) {
        stash.has_untracked = trees.next().is_some_and(|tree| tree != empty);
    }
    Ok(())
}

fn parse_entry(record: &str) -> Option<Stash> {
    let fields: Vec<&str> = record.trim_start_matches('\n').splitn(5, '\x1f').collect();
    let [oid, parents, name, date, subject] = fields[..] else {
        return None;
    };
    let parents: Vec<&str> = parents.split_whitespace().collect();
    let (branch, message) = parse_subject(subject);
    let auto = message
        .as_deref()
        .is_some_and(|m| m.starts_with(AUTO_STASH_PREFIX));
    Some(Stash {
        oid: oid.to_owned(),
        base: (*parents.first()?).to_owned(),
        name: name.to_owned(),
        branch,
        message,
        auto,
        has_untracked: parents.len() > 2,
        created_at: date.parse().unwrap_or(0),
    })
}

/// `On main: message` or `WIP on main: 1a2b3c4 summary`; the branch is
/// `(no branch)` on a detached HEAD.
fn parse_subject(subject: &str) -> (Option<String>, Option<String>) {
    let (wip, rest) = match subject.strip_prefix("WIP on ") {
        Some(rest) => (true, rest),
        None => match subject.strip_prefix("On ") {
            Some(rest) => (false, rest),
            None => return (None, Some(subject.to_owned())),
        },
    };
    let Some((branch, message)) = rest.split_once(": ") else {
        return (None, Some(subject.to_owned()));
    };
    let branch = (branch != "(no branch)").then(|| branch.to_owned());
    (branch, (!wip).then(|| message.to_owned()))
}

/// Puts the uncommitted changes aside and returns the new stash's id.
/// With `paths`, only those files. Untracked files go too with
/// `include_untracked`. Returns [`crate::ErrorKind::NothingToStash`] when
/// nothing matched, since git then makes no stash.
pub fn push(
    git: &Git,
    repo: &Path,
    message: Option<&str>,
    include_untracked: bool,
    paths: &[String],
) -> Result<String, GitError> {
    let before = top(git, repo)?;
    let mut command = git.command().cwd(repo).args(["stash", "push", "--quiet"]);
    if include_untracked {
        command = command.arg("--include-untracked");
    }
    if let Some(message) = message.map(str::trim).filter(|m| !m.is_empty()) {
        command = command.args(["--message", message]);
    }
    command = if paths.is_empty() {
        // `--include-untracked` cleans up with an internal `:/` pathspec,
        // which literal pathspecs break (untracked files stay behind).
        // No paths are passed here, so pattern matching is harmless.
        command.env("GIT_LITERAL_PATHSPECS", "0")
    } else {
        command.paths(paths)
    };
    command.run()?;
    match top(git, repo)? {
        Some(after) if Some(&after) != before.as_ref() => Ok(after),
        _ => Err(GitError::NothingToStash),
    }
}

/// How applying a stash went.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum ApplyOutcome {
    Applied,
    /// Applied, but which changes were staged couldn't be restored:
    /// everything is unstaged now.
    AppliedUnstaged,
    /// The changes conflicted with the working tree. The conflicts are
    /// there to resolve, and the stash stays, also when popping.
    Conflicted,
}

/// Applies a stash to the working tree, restoring which changes were
/// staged, and with `pop` removes it once applied cleanly.
///
/// Nothing changes when an untracked file of the stash already exists
/// ([`crate::ErrorKind::StashUntrackedExists`], checked first since git
/// would apply the tracked changes before failing) or uncommitted changes
/// would be overwritten
/// ([`crate::ErrorKind::LocalChangesWouldBeOverwritten`]).
pub fn apply(git: &Git, repo: &Path, oid: &str, pop: bool) -> Result<ApplyOutcome, GitError> {
    let selector = selector(git, repo, oid)?;
    // git would apply the tracked changes before failing on these.
    let existing: Vec<String> = untracked_paths(git, repo, oid)?
        .into_iter()
        .filter(|path| repo.join(path).symlink_metadata().is_ok())
        .collect();
    if !existing.is_empty() {
        return Err(GitError::StashUntrackedExists(existing));
    }
    let mut outcome = ApplyOutcome::Applied;
    let mut result = run_apply(git, repo, &selector, true);
    if let Err(GitError::Failed { stderr, .. }) = &result
        && stderr.contains("conflicts in index")
    {
        // git checks this before touching anything; the contents still
        // apply, only not split into staged and unstaged.
        outcome = ApplyOutcome::AppliedUnstaged;
        result = run_apply(git, repo, &selector, false);
    }
    if let Err(err) = result {
        if !crate::conflict::unmerged(git, repo)?.is_empty() {
            return Ok(ApplyOutcome::Conflicted);
        }
        return Err(err);
    }
    if pop {
        drop(git, repo, oid)?;
    }
    Ok(outcome)
}

fn run_apply(git: &Git, repo: &Path, selector: &str, index: bool) -> Result<(), GitError> {
    let mut command = git.command().cwd(repo).args(["stash", "apply"]);
    if index {
        command = command.arg("--index");
    }
    command.arg(selector).run()?;
    Ok(())
}

/// Deletes a stash. It can come back with [`restore`] until git prunes
/// unreachable objects.
pub fn drop(git: &Git, repo: &Path, oid: &str) -> Result<(), GitError> {
    let selector = selector(git, repo, oid)?;
    git.command()
        .cwd(repo)
        .args(["stash", "drop", "--quiet", &selector])
        .run()?;
    Ok(())
}

/// Puts a dropped stash back, on top of the list, with its old message.
pub fn restore(git: &Git, repo: &Path, oid: &str) -> Result<(), GitError> {
    check_oid(oid)?;
    let subject = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["log", "-1", "--format=%s", oid])
        .run()?
        .stdout_str()
        .trim()
        .to_owned();
    git.command()
        .cwd(repo)
        .args(["stash", "store", "--quiet", "--message", &subject, oid])
        .run()?;
    Ok(())
}

/// Creates branch `name` at the commit a stash was made on, switches to
/// it and pops the stash there, which can't conflict.
pub fn branch(git: &Git, repo: &Path, oid: &str, name: &str) -> Result<(), GitError> {
    crate::branch::validate_name(git, name)?;
    let selector = selector(git, repo, oid)?;
    git.command()
        .cwd(repo)
        .args(["stash", "branch", name, &selector])
        .run()?;
    Ok(())
}

/// The files a stash changes, untracked ones with
/// [`ChangeKind::Untracked`].
pub fn files(git: &Git, repo: &Path, oid: &str) -> Result<Vec<CommitFile>, GitError> {
    check_oid(oid)?;
    let tracked = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["diff", "--name-status", "-z", "--find-renames"])
        .args([&format!("{oid}^1"), oid])
        .run()?;
    let mut files = parse_name_status(&tracked.stdout_str());
    files.extend(
        untracked_paths(git, repo, oid)?
            .into_iter()
            .map(|path| CommitFile {
                path,
                orig_path: None,
                kind: ChangeKind::Untracked,
            }),
    );
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// The diff of one file of a stash: against the commit it was stashed on,
/// or for an untracked file, against nothing.
pub fn file_diff(
    git: &Git,
    repo: &Path,
    oid: &str,
    file: &CommitFile,
    ignore_whitespace: bool,
) -> Result<diff::FileDiff, GitError> {
    check_oid(oid)?;
    let (from, to) = diff_sides(git, repo, oid, file)?;
    diff_between(git, repo, &from, &to, file, ignore_whitespace)
}

/// The two tree-ishes a stash file's diff and images come from.
pub fn diff_sides(
    git: &Git,
    repo: &Path,
    oid: &str,
    file: &CommitFile,
) -> Result<(String, String), GitError> {
    check_oid(oid)?;
    if file.kind == ChangeKind::Untracked {
        let untracked = untracked_commit(git, repo, oid)?
            .ok_or_else(|| GitError::Parse(format!("stash {oid} has no untracked files")))?;
        Ok((diff::empty_tree(git, repo)?, untracked))
    } else {
        Ok((format!("{oid}^1"), oid.to_owned()))
    }
}

/// The untracked files a stash holds.
fn untracked_paths(git: &Git, repo: &Path, oid: &str) -> Result<Vec<String>, GitError> {
    let Some(untracked) = untracked_commit(git, repo, oid)? else {
        return Ok(Vec::new());
    };
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["ls-tree", "-r", "-z", "--name-only", &untracked])
        .run()?;
    Ok(output
        .stdout_str()
        .split('\0')
        .filter(|p| !p.is_empty())
        .map(str::to_owned)
        .collect())
}

/// The third parent, holding untracked files, if the stash has one.
fn untracked_commit(git: &Git, repo: &Path, oid: &str) -> Result<Option<String>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--quiet", "--verify", &format!("{oid}^3")])
        .run_unchecked()?;
    Ok(output
        .success()
        .then(|| output.stdout_str().trim().to_owned()))
}

/// Commit id of the newest stash, if any.
pub(crate) fn top(git: &Git, repo: &Path) -> Result<Option<String>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--quiet", "--verify", "refs/stash"])
        .run_unchecked()?;
    Ok(output
        .success()
        .then(|| output.stdout_str().trim().to_owned()))
}

/// The current `stash@{n}` of the stash `oid`.
fn selector(git: &Git, repo: &Path, oid: &str) -> Result<String, GitError> {
    check_oid(oid)?;
    list(git, repo)?
        .into_iter()
        .find(|s| s.oid == oid)
        .map(|s| s.name)
        .ok_or(GitError::StashNotFound)
}

/// A stash Garam made when leaving a branch, to restore on coming back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AutoStash {
    /// Commit id of the stash entry; stable while `stash@{n}` indexes shift.
    pub oid: String,
    pub branch: String,
}

/// The newest stash Garam made when leaving `branch`, if any.
pub fn find_auto(git: &Git, repo: &Path, branch: &str) -> Result<Option<AutoStash>, GitError> {
    Ok(list(git, repo)?.into_iter().find_map(|s| {
        let label = s.message.as_deref()?.strip_prefix(AUTO_STASH_PREFIX)?;
        (s.auto && label == branch).then(|| AutoStash {
            oid: s.oid,
            branch: label.to_owned(),
        })
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_branch_and_message() {
        assert_eq!(
            parse_subject("On main: my work"),
            (Some("main".into()), Some("my work".into()))
        );
        assert_eq!(
            parse_subject("WIP on feature/한글: 1a2b3c4 Fix: it"),
            (Some("feature/한글".into()), None)
        );
        assert_eq!(
            parse_subject("On (no branch): detached"),
            (None, Some("detached".into()))
        );
        assert_eq!(parse_subject("odd"), (None, Some("odd".into())));
    }

    #[test]
    fn parses_list_entries() {
        let record =
            "\naaa\x1fbbb ccc ddd\x1fstash@{1}\x1f1700000000\x1fOn main: garam-auto-stash:main";
        let stash = parse_entry(record).unwrap();
        assert_eq!(stash.oid, "aaa");
        assert_eq!(stash.base, "bbb");
        assert_eq!(stash.name, "stash@{1}");
        assert_eq!(stash.branch.as_deref(), Some("main"));
        assert!(stash.auto);
        assert!(stash.has_untracked);
        assert_eq!(stash.created_at, 1_700_000_000);
    }
}
