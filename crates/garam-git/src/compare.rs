//! Comparing two commits or branches, and finding commits no branch holds.

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::diff::FileDiff;
use crate::log::{self, CommitFile, CommitSummary};
use crate::{Git, GitError};

/// At most this many commits are listed for a comparison.
const MAX_COMMITS: u32 = 100;
/// How far back the reflog is searched for lost commits.
const MAX_REFLOG: u32 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum CompareMode {
    /// What changed from `base` to `target` (`git diff base target`).
    TwoDot,
    /// What `target` changed since it split from `base` (`base...target`),
    /// as a pull request shows it.
    ThreeDot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub base: String,
    pub target: String,
    /// The commit the diff starts from: `base`, or the merge base for a
    /// three-dot comparison of branches that share history.
    pub from: String,
    /// Commits on `target` that `base` lacks.
    pub ahead: u32,
    /// Commits on `base` that `target` lacks.
    pub behind: u32,
    /// The first of the `ahead` commits, newest first.
    pub commits: Vec<CommitSummary>,
    pub files: Vec<CommitFile>,
}

/// Resolves a commit id or a full ref name (`refs/heads/x`) to a commit
/// id. Nothing else is accepted, so input can't pose as an option or a
/// revision expression.
fn resolve(git: &Git, repo: &Path, rev: &str) -> Result<String, GitError> {
    let allowed = rev.starts_with("refs/") || log::check_oid(rev).is_ok();
    allowed
        .then(|| crate::commit::resolve_commit(git, repo, rev))
        .transpose()?
        .flatten()
        .ok_or_else(|| GitError::Parse(format!("not a commit: {rev:?}")))
}

pub fn compare(
    git: &Git,
    repo: &Path,
    base: &str,
    target: &str,
    mode: CompareMode,
) -> Result<Comparison, GitError> {
    let base = resolve(git, repo, base)?;
    let target = resolve(git, repo, target)?;
    let from = match mode {
        CompareMode::TwoDot => base.clone(),
        CompareMode::ThreeDot => merge_base(git, repo, &base, &target)?.unwrap_or(base.clone()),
    };

    let counts = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-list", "--left-right", "--count"])
        .arg(format!("{base}...{target}"))
        .arg("--")
        .run()?;
    let counts = counts.stdout_str();
    let mut counts = counts.split_whitespace().map(str::parse);
    let behind = counts.next().and_then(Result::ok).unwrap_or(0);
    let ahead = counts.next().and_then(Result::ok).unwrap_or(0);

    let commits = log::log_records(
        git,
        repo,
        &[target.clone(), format!("^{base}")],
        &[],
        0,
        MAX_COMMITS,
    )?;
    let names = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "diff",
            "-z",
            "--name-status",
            "--find-renames",
            &from,
            &target,
        ])
        .arg("--")
        .run()?;
    Ok(Comparison {
        files: log::parse_name_status(&names.stdout_str()),
        base,
        target,
        from,
        ahead,
        behind,
        commits,
    })
}

fn merge_base(git: &Git, repo: &Path, a: &str, b: &str) -> Result<Option<String>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["merge-base", a, b])
        .run_unchecked()?;
    Ok(output
        .success()
        .then(|| output.stdout_str().trim().to_owned())
        .filter(|oid| !oid.is_empty()))
}

/// One file's diff in a comparison, from `from` to `target` (both commit
/// ids from a [`Comparison`]).
pub fn file_diff(
    git: &Git,
    repo: &Path,
    from: &str,
    target: &str,
    file: &CommitFile,
    ignore_whitespace: bool,
) -> Result<FileDiff, GitError> {
    log::check_oid(from)?;
    log::check_oid(target)?;
    log::diff_between(git, repo, from, target, file, ignore_whitespace)
}

/// A commit HEAD was on that no branch, tag or remote branch holds now,
/// e.g. after a reset or a deleted branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct LostCommit {
    #[serde(flatten)]
    pub commit: CommitSummary,
    /// git's note on how HEAD got there, e.g. `commit: Fix x` or
    /// `reset: moving to HEAD~1`.
    pub action: String,
    /// When HEAD was there, in seconds since the Unix epoch.
    pub visited_at: u32,
}

/// Commits from HEAD's reflog that nothing else holds, newest first. Only
/// the newest of a lost line of commits is listed: restoring it brings
/// back the ones before it.
pub fn lost_commits(git: &Git, repo: &Path) -> Result<Vec<LostCommit>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "log",
            "--walk-reflogs",
            "-z",
            "--date=unix",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%gd%x1f%gs",
            &format!("--max-count={MAX_REFLOG}"),
            "HEAD",
            "--",
        ])
        .run_unchecked()?;
    // No reflog yet (a new repository) is nothing lost.
    if !output.success() {
        return Ok(Vec::new());
    }
    let mut seen = HashSet::new();
    let entries: Vec<LostCommit> = output
        .stdout_str()
        .split('\0')
        .filter_map(parse_reflog_entry)
        .filter(|entry| seen.insert(entry.commit.oid.clone()))
        .collect();
    if entries.is_empty() {
        return Ok(entries);
    }

    let oids: String = entries
        .iter()
        .map(|e| format!("{}\n", e.commit.oid))
        .collect();
    let mut not = vec!["--not", "--branches", "--tags", "--remotes"];
    if crate::commit::head_oid(git, repo)?.is_some() {
        not.push("HEAD");
    }
    let unreachable = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-list", "--stdin"])
        .args(not)
        .stdin(oids.into_bytes())
        .run()?;
    let unreachable = unreachable.stdout_str();
    let lost: Vec<&str> = unreachable
        .lines()
        .map(str::trim)
        .filter(|oid| entries.iter().any(|e| e.commit.oid == *oid))
        .collect();
    if lost.is_empty() {
        return Ok(Vec::new());
    }
    let tips = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["merge-base", "--independent"])
        .args(&lost)
        .run()?;
    let tips: HashSet<String> = tips.stdout_str().lines().map(str::to_owned).collect();
    Ok(entries
        .into_iter()
        .filter(|e| tips.contains(&e.commit.oid))
        .collect())
}

fn parse_reflog_entry(record: &str) -> Option<LostCommit> {
    let f: Vec<&str> = record.trim_start_matches('\n').splitn(8, '\x1f').collect();
    let [_, _, _, _, _, _, selector, action] = f[..] else {
        return None;
    };
    let commit = log::parse_summary(&f[..6].join("\x1f")).ok()?;
    let visited_at = selector
        .rsplit_once("@{")
        .and_then(|(_, rest)| rest.strip_suffix('}'))
        .and_then(|n| n.parse().ok())
        .unwrap_or(commit.authored_at);
    Some(LostCommit {
        commit,
        action: action.to_owned(),
        visited_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_reflog_entries() {
        let entry = parse_reflog_entry(
            "aaa\x1fbbb\x1f김가람\x1fg@example.com\x1f1700000000\x1fFix x\x1fHEAD@{1700000100}\x1freset: moving to HEAD~1",
        )
        .unwrap();
        assert_eq!(entry.commit.oid, "aaa");
        assert_eq!(entry.commit.summary, "Fix x");
        assert_eq!(entry.action, "reset: moving to HEAD~1");
        assert_eq!(entry.visited_at, 1_700_000_100);
        assert!(parse_reflog_entry("").is_none());
    }
}
