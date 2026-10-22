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

/// Marker in stash messages created by Garam, followed by the branch name.
const AUTO_STASH_PREFIX: &str = "garam-auto-stash:";

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
        let before = stash_top(git, repo)?;
        let label = current.unwrap_or("HEAD");
        git.command()
            .cwd(repo)
            .args(["stash", "push", "--include-untracked", "--message"])
            .arg(format!("{AUTO_STASH_PREFIX}{label}"))
            .run()?;
        let after = stash_top(git, repo)?;
        if after != before {
            created_stash = after;
        }
    }
    let result = match target.kind {
        BranchKind::Local => git
            .command()
            .cwd(repo)
            .args(["switch", "--no-guess", &target.name])
            .run(),
        BranchKind::Remote => {
            // Reuse a local branch of the same name instead of failing.
            let local = local_name_of(target);
            if local_exists(git, repo, local)? {
                git.command()
                    .cwd(repo)
                    .args(["switch", "--no-guess", local])
                    .run()
            } else {
                git.command()
                    .cwd(repo)
                    .args(["switch", "--track", &target.name])
                    .run()
            }
        }
    };
    if let Err(err) = result {
        if let Some(oid) = created_stash {
            let _ = pop_stash(git, repo, &oid);
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

/// Commit id of the newest stash entry, if any.
fn stash_top(git: &Git, repo: &Path) -> Result<Option<String>, GitError> {
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

pub fn rename(git: &Git, repo: &Path, old: &str, new: &str) -> Result<(), GitError> {
    validate_name(git, new)?;
    git.command()
        .cwd(repo)
        .args(["branch", "--move", old, new])
        .run()?;
    Ok(())
}

/// Deletes a local branch. Without `force`, git refuses if it has commits
/// not merged anywhere ([`crate::ErrorKind::BranchNotMerged`]).
pub fn delete(git: &Git, repo: &Path, name: &str, force: bool) -> Result<(), GitError> {
    git.command()
        .cwd(repo)
        .args(["branch", if force { "-D" } else { "-d" }, name])
        .run()?;
    Ok(())
}

/// Number of commits on `branch` that HEAD doesn't have yet.
pub fn commits_to_merge(git: &Git, repo: &Path, branch: &str) -> Result<u32, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-list", "--count", &format!("HEAD..{branch}")])
        .run()?;
    output
        .stdout_str()
        .trim()
        .parse()
        .map_err(|_| GitError::Parse(output.stdout_str().into_owned()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum MergeOutcome {
    UpToDate,
    FastForward,
    Merged,
}

/// Merges `branch` into the current branch. Conflicts leave the merge in
/// progress and return [`crate::ErrorKind::MergeConflict`].
pub fn merge(git: &Git, repo: &Path, branch: &str) -> Result<MergeOutcome, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .args(["merge", "--no-edit", branch])
        .run()?;
    let text = output.stdout_str();
    Ok(if text.contains("Already up to date") {
        MergeOutcome::UpToDate
    } else if text.contains("Fast-forward") {
        MergeOutcome::FastForward
    } else {
        MergeOutcome::Merged
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AutoStash {
    /// Commit id of the stash entry; stable while `stash@{n}` indexes shift.
    pub oid: String,
    pub branch: String,
}

/// The newest stash Garam made when leaving `branch`, if any.
pub fn find_auto_stash(
    git: &Git,
    repo: &Path,
    branch: &str,
) -> Result<Option<AutoStash>, GitError> {
    Ok(stash_entries(git, repo)?
        .into_iter()
        .find(|(_, _, b)| b == branch)
        .map(|(_, oid, branch)| AutoStash { oid, branch }))
}

/// `(stash@{n}, oid, branch)` for every Garam auto-stash, newest first.
fn stash_entries(git: &Git, repo: &Path) -> Result<Vec<(String, String, String)>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["stash", "list", "--format=%gd%x00%H%x00%gs"])
        .run()?;
    Ok(output
        .stdout_str()
        .lines()
        .filter_map(|line| {
            let mut f = line.splitn(3, '\0');
            let (selector, oid, subject) = (f.next()?, f.next()?, f.next()?);
            // Subject looks like "On main: garam-auto-stash:main".
            let (_, message) = subject.split_once(": ")?;
            let branch = message.strip_prefix(AUTO_STASH_PREFIX)?;
            Some((selector.to_owned(), oid.to_owned(), branch.to_owned()))
        })
        .collect())
}

fn selector_for(git: &Git, repo: &Path, oid: &str) -> Result<String, GitError> {
    stash_entries(git, repo)?
        .into_iter()
        .find(|(_, o, _)| o == oid)
        .map(|(selector, _, _)| selector)
        .ok_or_else(|| GitError::Parse(format!("stash {oid} no longer exists")))
}

/// Applies an auto-stash to the working tree and removes it.
pub fn pop_stash(git: &Git, repo: &Path, oid: &str) -> Result<(), GitError> {
    let selector = selector_for(git, repo, oid)?;
    git.command()
        .cwd(repo)
        .args(["stash", "pop", "--index", &selector])
        .run()?;
    Ok(())
}

/// Deletes an auto-stash without applying it.
pub fn drop_stash(git: &Git, repo: &Path, oid: &str) -> Result<(), GitError> {
    let selector = selector_for(git, repo, oid)?;
    git.command()
        .cwd(repo)
        .args(["stash", "drop", "--quiet", &selector])
        .run()?;
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
