//! Branches: listing, creating, switching, renaming, deleting, merging.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Git, GitError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum BranchKind {
    Local,
    Remote,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    /// Short name: `main` or `origin/main`.
    pub name: String,
    pub kind: BranchKind,
    /// For remote branches, the remote's name (`origin`).
    pub remote: Option<String>,
    pub oid: String,
    pub is_head: bool,
    /// For local branches, the tracked remote branch (`origin/main`).
    pub upstream: Option<String>,
    /// The upstream branch was deleted on the remote.
    pub upstream_gone: bool,
    pub ahead: u32,
    pub behind: u32,
    /// Seconds since the Unix epoch of the tip commit. (u32 so it maps to a
    /// plain TypeScript number; good until 2106.)
    pub committed_at: u32,
    pub subject: String,
}

/// All local and remote-tracking branches.
pub fn list(git: &Git, repo: &Path) -> Result<Vec<Branch>, GitError> {
    const FORMAT: &str = "%(refname)%00%(refname:short)%00%(objectname)%00%(HEAD)%00\
                          %(upstream:short)%00%(upstream:track,nobracket)%00\
                          %(committerdate:unix)%00%(subject)";
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["for-each-ref", &format!("--format={FORMAT}")])
        .args(["refs/heads", "refs/remotes"])
        .run()?;
    Ok(parse_list(&output.stdout_str()))
}

fn parse_list(output: &str) -> Vec<Branch> {
    output
        .lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.splitn(8, '\0').collect();
            let [full, short, oid, head, upstream, track, date, subject] = f[..] else {
                return None;
            };
            let (kind, remote) = if full.starts_with("refs/heads/") {
                (BranchKind::Local, None)
            } else {
                // refs/remotes/<remote>/<branch>; skip the symbolic origin/HEAD.
                let rest = full.strip_prefix("refs/remotes/")?;
                let (remote, branch) = rest.split_once('/')?;
                if branch == "HEAD" {
                    return None;
                }
                (BranchKind::Remote, Some(remote.to_owned()))
            };
            let (ahead, behind, gone) = parse_track(track);
            Some(Branch {
                name: short.to_owned(),
                kind,
                remote,
                oid: oid.to_owned(),
                is_head: head == "*",
                upstream: (!upstream.is_empty()).then(|| upstream.to_owned()),
                upstream_gone: gone,
                ahead,
                behind,
                committed_at: date.parse().unwrap_or(0),
                subject: subject.to_owned(),
            })
        })
        .collect()
}

/// Where a local branch pushes and pulls.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Upstream {
    /// The local branch, e.g. `feature`.
    pub branch: String,
    pub oid: String,
    pub is_head: bool,
    /// The remote's name, e.g. `origin`.
    pub remote: String,
    /// The branch's name on the remote, which may differ from the local one.
    pub remote_branch: String,
}

/// Local branches that track a branch on a remote. Read from git rather
/// than split from `origin/feature`, since remote names may hold a `/`.
pub fn upstreams(git: &Git, repo: &Path) -> Result<Vec<Upstream>, GitError> {
    const FORMAT: &str =
        "%(refname)%00%(objectname)%00%(HEAD)%00%(upstream:remotename)%00%(upstream:remoteref)";
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["for-each-ref", &format!("--format={FORMAT}"), "refs/heads"])
        .run()?;
    Ok(output
        .stdout_str()
        .lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.splitn(5, '\0').collect();
            let [full, oid, head, remote, remote_ref] = f[..] else {
                return None;
            };
            // An upstream on a local branch (`.` remote) has no remote name.
            if remote.is_empty() || remote == "." {
                return None;
            }
            Some(Upstream {
                branch: full.strip_prefix("refs/heads/")?.to_owned(),
                oid: oid.to_owned(),
                is_head: head == "*",
                remote: remote.to_owned(),
                remote_branch: remote_ref.strip_prefix("refs/heads/")?.to_owned(),
            })
        })
        .collect())
}

/// Parses `ahead 1, behind 2`, `ahead 3`, `gone` or an empty string.
fn parse_track(track: &str) -> (u32, u32, bool) {
    let (mut ahead, mut behind) = (0, 0);
    if track == "gone" {
        return (0, 0, true);
    }
    for part in track.split(", ") {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(0);
        }
    }
    (ahead, behind, false)
}

/// Checks a new branch name the way git does.
pub fn validate_name(git: &Git, name: &str) -> Result<(), GitError> {
    let output = git
        .command()
        .args(["check-ref-format", "--branch", name])
        .run_unchecked()?;
    if output.success() && !name.starts_with('-') {
        Ok(())
    } else {
        Err(GitError::InvalidBranchName(name.to_owned()))
    }
}

/// Creates `name` at `start` (default: HEAD) and switches to it. Local
/// changes come along, which never conflicts for a new branch.
pub fn create(git: &Git, repo: &Path, name: &str, start: Option<&str>) -> Result<(), GitError> {
    validate_name(git, name)?;
    let mut command = git
        .command()
        .cwd(repo)
        .args(["switch", "--no-guess", "-c", name]);
    if let Some(start) = start {
        // A start point is a revision, never an option.
        if start.starts_with('-') {
            return Err(GitError::Parse(format!("not a revision: {start:?}")));
        }
        command = command.arg(start);
    }
    command.run()?;
    Ok(())
}

/// How to treat uncommitted changes when switching branches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum SwitchMode {
    /// Take the changes to the other branch (fails if they'd be overwritten).
    BringChanges,
    /// Stash the changes on the current branch first.
    LeaveChanges,
}

/// Switches to a local branch, or to a remote branch by creating a local
/// tracking branch of the same name.
pub fn switch(
    git: &Git,
    repo: &Path,
    target: &Branch,
    mode: SwitchMode,
    current: Option<&str>,
) -> Result<(), GitError> {
    // Only roll back a stash this call created: with nothing to stash, git
    // makes no entry, and popping would grab an unrelated older one.
    let mut created_stash = None;
    if mode == SwitchMode::LeaveChanges {
        let before = crate::stash::top(git, repo)?;
        let label = current.unwrap_or("HEAD");
        git.command()
            .cwd(repo)
            // `--include-untracked` cleans up with an internal `:/` pathspec,
            // which literal pathspecs break (untracked files stay behind).
            // No paths are passed here, so pattern matching is harmless.
            .env("GIT_LITERAL_PATHSPECS", "0")
            .args(["stash", "push", "--include-untracked", "--message"])
            .arg(format!("{}{label}", crate::stash::AUTO_STASH_PREFIX))
            .run()?;
        let after = crate::stash::top(git, repo)?;
        if after != before {
            created_stash = after;
        }
    }
    let result = match target.kind {
        BranchKind::Local => git
            .command()
            .cwd(repo)
            .args(["switch", "--no-guess", "--end-of-options", &target.name])
            .run(),
        BranchKind::Remote => {
            // Reuse a local branch of the same name instead of failing.
            let local = local_name_of(target);
            if local_exists(git, repo, local)? {
                git.command()
                    .cwd(repo)
                    .args(["switch", "--no-guess", "--end-of-options", local])
                    .run()
            } else {
                git.command()
                    .cwd(repo)
                    .args(["switch", "--track", "--end-of-options", &target.name])
                    .run()
            }
        }
    };
    if let Err(err) = result {
        if let Some(oid) = created_stash {
            let _ = crate::stash::apply(git, repo, &oid, true);
        }
        return Err(err);
    }
    Ok(())
}

/// `origin/feature/x` → `feature/x`.
fn local_name_of(remote: &Branch) -> &str {
    remote
        .remote
        .as_deref()
        .and_then(|r| remote.name.strip_prefix(r))
        .and_then(|rest| rest.strip_prefix('/'))
        .unwrap_or(&remote.name)
}

fn local_exists(git: &Git, repo: &Path, name: &str) -> Result<bool, GitError> {
    Ok(git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{name}"),
        ])
        .run_unchecked()?
        .success())
}

pub fn rename(git: &Git, repo: &Path, old: &str, new: &str) -> Result<(), GitError> {
    validate_name(git, new)?;
    git.command()
        .cwd(repo)
        .args(["branch", "--move", "--end-of-options", old, new])
        .run()?;
    Ok(())
}

/// Deletes a local branch. Without `force`, git refuses if it has commits
/// not merged anywhere ([`crate::ErrorKind::BranchNotMerged`]).
pub fn delete(git: &Git, repo: &Path, name: &str, force: bool) -> Result<(), GitError> {
    git.command()
        .cwd(repo)
        .args([
            "branch",
            if force { "-D" } else { "-d" },
            "--end-of-options",
            name,
        ])
        .run()?;
    Ok(())
}

/// Number of commits on `theirs` that `ours` doesn't have yet.
fn count_missing(git: &Git, repo: &Path, ours: &str, theirs: &str) -> Result<u32, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-list", "--count", &format!("{ours}..{theirs}")])
        .run()?;
    output
        .stdout_str()
        .trim()
        .parse()
        .map_err(|_| GitError::Parse(output.stdout_str().into_owned()))
}

/// What merging a branch into HEAD would do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MergePreview {
    /// Commits it would bring in.
    pub commits: u32,
    /// Files that would conflict; `None` when git can't tell (older than
    /// 2.38, or unrelated histories).
    pub conflicts: Option<Vec<String>>,
}

/// How merging `theirs` into HEAD would go, without touching the working
/// tree or the index.
pub fn merge_preview(git: &Git, repo: &Path, theirs: &str) -> Result<MergePreview, GitError> {
    let commits = count_missing(git, repo, "HEAD", theirs)?;
    let conflicts = if commits == 0 {
        Some(Vec::new())
    } else {
        conflict_files(git, repo, "HEAD", theirs)?
    };
    Ok(MergePreview { commits, conflicts })
}

/// The files merging `theirs` into `ours` would leave conflicted, from an
/// in-memory merge (`merge-tree --write-tree`, git 2.38+). `None` when git
/// can't do it: too old (a usage error), or no common history.
pub fn conflict_files(
    git: &Git,
    repo: &Path,
    ours: &str,
    theirs: &str,
) -> Result<Option<Vec<String>>, GitError> {
    Ok(merge_tree(git, repo, ours, theirs)?.map(|result| result.conflicts))
}

struct MergeTree {
    tree: String,
    conflicts: Vec<String>,
}

fn merge_tree(
    git: &Git,
    repo: &Path,
    ours: &str,
    theirs: &str,
) -> Result<Option<MergeTree>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .args([
            "merge-tree",
            "--write-tree",
            "-z",
            "--name-only",
            "--no-messages",
            "--end-of-options",
            ours,
            theirs,
        ])
        .run_unchecked()?;
    // 0: merged cleanly; 1: conflicts. Anything else means no answer.
    if !matches!(output.code, Some(0 | 1)) {
        return Ok(None);
    }
    let text = output.stdout_str();
    let mut fields = text.split('\0').filter(|f| !f.is_empty());
    let tree = fields.next().unwrap_or_default().to_owned();
    let mut conflicts: Vec<String> = Vec::new();
    for path in fields {
        // A path is listed once per conflict it has.
        if !conflicts.iter().any(|p| p == path) {
            conflicts.push(path.to_owned());
        }
    }
    Ok(Some(MergeTree { tree, conflicts }))
}

/// Whether everything `branch` changed is already in `base`, even when its
/// commits aren't (a squash merge): merging it in would change nothing.
fn changes_contained(git: &Git, repo: &Path, base: &str, branch: &str) -> Result<bool, GitError> {
    let Some(merged) = merge_tree(git, repo, base, branch)? else {
        return Ok(false);
    };
    if !merged.conflicts.is_empty() {
        return Ok(false);
    }
    let base_tree = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{base}^{{tree}}"),
        ])
        .run_unchecked()?;
    Ok(base_tree.success() && base_tree.stdout_str().trim() == merged.tree)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum MergeOutcome {
    UpToDate,
    FastForward,
    Merged,
    /// The branch's own commits were replayed on top ([`update_from`]).
    Rebased,
}

/// Merges `branch` into the current branch. Conflicts leave the merge in
/// progress and return [`crate::ErrorKind::MergeConflict`].
pub fn merge(git: &Git, repo: &Path, branch: &str) -> Result<MergeOutcome, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .args(["merge", "--no-edit", "--end-of-options", branch])
        .run()?;
    Ok(merge_outcome(&output.stdout_str()))
}

/// The remote's default branch the current branch was made from, as a
/// remote-tracking ref.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Base {
    /// `origin/main`.
    short: String,
    /// `refs/remotes/origin/main`.
    full: String,
    /// `main`.
    branch: String,
}

/// The default branch of the remote the current branch works with (its
/// upstream's remote, else `origin`), if git recorded one and it exists
/// locally.
fn default_base(git: &Git, repo: &Path) -> Result<Option<Base>, GitError> {
    let info = crate::remote::info(git, repo)?;
    let Some(remote) = info.default_remote else {
        return Ok(None);
    };
    let Some(branch) = crate::remote::default_branch(git, repo, &remote)? else {
        return Ok(None);
    };
    let full = format!("refs/remotes/{remote}/{branch}");
    let exists = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--verify", "--quiet", &full])
        .run_unchecked()?
        .success();
    Ok(exists.then(|| Base {
        short: format!("{remote}/{branch}"),
        full,
        branch,
    }))
}

fn current_branch(git: &Git, repo: &Path) -> Result<Option<String>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["symbolic-ref", "--quiet", "--short", "HEAD"])
        .run_unchecked()?;
    Ok(output
        .success()
        .then(|| output.stdout_str().trim().to_owned())
        .filter(|b| !b.is_empty()))
}

/// How far the remote's default branch has moved on from the current one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BaseStatus {
    /// The remote-tracking branch, `origin/main`.
    pub base: String,
    /// The default branch's own name, `main`.
    pub base_branch: String,
    /// Commits on the base the current branch doesn't have.
    pub behind: u32,
    /// Files that would conflict if it were merged in now (see
    /// [`MergePreview::conflicts`]).
    pub conflicts: Option<Vec<String>>,
    /// The current branch is on the remote, so it shouldn't be rebased.
    pub published: bool,
}

/// Where the current branch stands against the remote's default branch.
/// `None` on the default branch itself, with HEAD detached, before the
/// first commit, or when git doesn't know the default branch.
pub fn base_status(git: &Git, repo: &Path) -> Result<Option<BaseStatus>, GitError> {
    let Some(current) = current_branch(git, repo)? else {
        return Ok(None);
    };
    let Some(base) = default_base(git, repo)? else {
        return Ok(None);
    };
    if current == base.branch || crate::commit::head_oid(git, repo)?.is_none() {
        return Ok(None);
    }
    let preview = merge_preview(git, repo, &base.full)?;
    Ok(Some(BaseStatus {
        base: base.short,
        base_branch: base.branch,
        behind: preview.commits,
        conflicts: preview.conflicts,
        published: is_published(git, repo, &current)?,
    }))
}

/// Whether `branch` has an upstream that still exists on the remote.
fn is_published(git: &Git, repo: &Path, branch: &str) -> Result<bool, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{branch}@{{upstream}}"),
        ])
        .run_unchecked()?;
    Ok(output.success())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum UpdateMode {
    Merge,
    Rebase,
}

/// Brings `base` (a remote-tracking branch such as `origin/main`) into the
/// current branch, setting uncommitted changes aside meanwhile
/// (`--autostash`). Conflicts leave the merge or rebase in progress and
/// return [`crate::ErrorKind::MergeConflict`] or
/// [`crate::ErrorKind::RebaseConflict`].
pub fn update_from(
    git: &Git,
    repo: &Path,
    base: &str,
    mode: UpdateMode,
) -> Result<MergeOutcome, GitError> {
    if mode == UpdateMode::Merge {
        let output = git
            .command()
            .cwd(repo)
            .args([
                "merge",
                "--no-edit",
                "--autostash",
                "--end-of-options",
                base,
            ])
            .run()?;
        return Ok(merge_outcome(&output.stdout_str()));
    }
    let before = crate::commit::head_oid(git, repo)?;
    git.command()
        .cwd(repo)
        .args(["rebase", "--autostash", "--end-of-options", base])
        .run()?;
    let after = crate::commit::head_oid(git, repo)?;
    Ok(if before == after {
        MergeOutcome::UpToDate
    } else {
        MergeOutcome::Rebased
    })
}

fn merge_outcome(stdout: &str) -> MergeOutcome {
    if stdout.contains("Already up to date") {
        MergeOutcome::UpToDate
    } else if stdout.contains("Fast-forward") {
        MergeOutcome::FastForward
    } else {
        MergeOutcome::Merged
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum CleanupReason {
    /// Everything on it is in the default branch (merged or squashed).
    Merged,
    /// Its upstream was deleted on the remote.
    Gone,
}

/// A local branch that can probably go.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CleanupCandidate {
    pub name: String,
    pub reason: CleanupReason,
    /// For a gone branch, commits the default branch doesn't have, which
    /// deleting it could lose. `None` without a default branch to compare.
    pub unmerged: Option<u32>,
    pub committed_at: u32,
}

/// Local branches merged into the remote's default branch (by their
/// commits or, after a squash merge, by their changes) or whose upstream
/// was deleted on the remote. Never the current branch or the default one.
pub fn cleanup_candidates(git: &Git, repo: &Path) -> Result<Vec<CleanupCandidate>, GitError> {
    let base = default_base(git, repo)?;
    let merged: Vec<String> = match &base {
        Some(base) => git
            .command()
            .cwd(repo)
            .read_only()
            .args([
                "for-each-ref",
                "--format=%(refname:short)",
                &format!("--merged={}", base.full),
                "refs/heads",
            ])
            .run()?
            .stdout_str()
            .lines()
            .map(str::to_owned)
            .collect(),
        None => Vec::new(),
    };
    let mut candidates = Vec::new();
    for branch in list(git, repo)? {
        if branch.kind != BranchKind::Local
            || branch.is_head
            || base.as_ref().is_some_and(|b| b.branch == branch.name)
        {
            continue;
        }
        // A branch made but not yet worked on is an ancestor of the base
        // too; it is about to be used, not finished with.
        let merged = match &base {
            Some(base) => {
                (merged.contains(&branch.name)
                    || changes_contained(git, repo, &base.full, &branch.oid)?)
                    && !untouched(git, repo, &branch.name)?
            }
            None => false,
        };
        let reason = if merged {
            CleanupReason::Merged
        } else if branch.upstream_gone {
            CleanupReason::Gone
        } else {
            continue;
        };
        let unmerged = match (&base, reason) {
            (_, CleanupReason::Merged) => Some(0),
            (Some(base), CleanupReason::Gone) => {
                Some(count_missing(git, repo, &base.full, &branch.oid)?)
            }
            (None, CleanupReason::Gone) => None,
        };
        candidates.push(CleanupCandidate {
            name: branch.name,
            reason,
            unmerged,
            committed_at: branch.committed_at,
        });
    }
    Ok(candidates)
}

/// Whether the branch's reflog shows nothing but its creation. Without a
/// reflog (turned off) it can't tell and says no.
fn untouched(git: &Git, repo: &Path, name: &str) -> Result<bool, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["reflog", "show", "--format=%gs", "--end-of-options"])
        .arg(format!("refs/heads/{name}"))
        .run_unchecked()?;
    let text = output.stdout_str();
    let entries: Vec<&str> = text.lines().collect();
    Ok(output.success() && entries.len() == 1 && entries[0].starts_with("branch: Created from"))
}

/// A deleted branch, with what it takes to bring it back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DeletedBranch {
    pub name: String,
    pub oid: String,
    /// `branch.<name>.remote` and `branch.<name>.merge`, which deleting
    /// the branch removes.
    pub remote: Option<String>,
    pub merge: Option<String>,
}

/// Deletes local branches whatever their merge state (the caller decided),
/// returning what [`restore`] needs to undo it.
pub fn delete_many(
    git: &Git,
    repo: &Path,
    names: &[String],
) -> Result<Vec<DeletedBranch>, GitError> {
    let mut deleted = Vec::new();
    for name in names {
        let oid = git
            .command()
            .cwd(repo)
            .read_only()
            .args([
                "rev-parse",
                "--verify",
                "--end-of-options",
                &format!("refs/heads/{name}"),
            ])
            .run()?
            .stdout_str()
            .trim()
            .to_owned();
        deleted.push(DeletedBranch {
            name: name.clone(),
            oid,
            remote: crate::remote::config_get(git, repo, &format!("branch.{name}.remote"))?,
            merge: crate::remote::config_get(git, repo, &format!("branch.{name}.merge"))?,
        });
    }
    if !names.is_empty() {
        git.command()
            .cwd(repo)
            .args(["branch", "-D", "--end-of-options"])
            .args(names)
            .run()?;
    }
    Ok(deleted)
}

/// Recreates branches [`delete_many`] deleted, upstream settings included.
pub fn restore(git: &Git, repo: &Path, deleted: &[DeletedBranch]) -> Result<(), GitError> {
    for branch in deleted {
        git.command()
            .cwd(repo)
            .args([
                "branch",
                "--no-track",
                "--end-of-options",
                &branch.name,
                &branch.oid,
            ])
            .run()?;
        for (key, value) in [("remote", &branch.remote), ("merge", &branch.merge)] {
            if let Some(value) = value {
                git.command()
                    .cwd(repo)
                    .args(["config", &format!("branch.{}.{key}", branch.name), value])
                    .run()?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_listing() {
        let out = concat!(
            "refs/heads/main\0main\0aaa\0*\0origin/main\0ahead 1, behind 2\01700000000\0Init\n",
            "refs/heads/feature/한글\0feature/한글\0bbb\0 \0\0\01700000100\0Work: in progress\n",
            "refs/heads/old\0old\0ccc\0 \0origin/old\0gone\01600000000\0Old\n",
            "refs/remotes/origin/HEAD\0origin\0aaa\0 \0\0\01700000000\0Init\n",
            "refs/remotes/origin/main\0origin/main\0ddd\0 \0\0\01700000000\0Init\n",
        );
        let branches = parse_list(out);
        assert_eq!(branches.len(), 4);

        let main = &branches[0];
        assert!(main.is_head);
        assert_eq!(main.upstream.as_deref(), Some("origin/main"));
        assert_eq!((main.ahead, main.behind), (1, 2));

        assert_eq!(branches[1].name, "feature/한글");
        assert_eq!(branches[1].subject, "Work: in progress");
        assert_eq!(branches[1].upstream, None);

        assert!(branches[2].upstream_gone);

        assert_eq!(branches[3].kind, BranchKind::Remote);
        assert_eq!(branches[3].remote.as_deref(), Some("origin"));
    }

    #[test]
    fn parses_tracking_info() {
        assert_eq!(parse_track(""), (0, 0, false));
        assert_eq!(parse_track("ahead 3"), (3, 0, false));
        assert_eq!(parse_track("behind 4"), (0, 4, false));
        assert_eq!(parse_track("gone"), (0, 0, true));
    }
}
