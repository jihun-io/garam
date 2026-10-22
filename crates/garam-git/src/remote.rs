//! Remotes: listing, fetch, pull, push and publish.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::{CancelToken, Git, GitCommand, GitError, Progress, ProgressParser, TransferKind};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Remote {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub remotes: Vec<Remote>,
    /// Remote used by fetch and publish: the current branch's upstream
    /// remote, else `origin`, else the first one.
    pub default_remote: Option<String>,
    /// Seconds since the Unix epoch of the last fetch, if any.
    pub last_fetched_at: Option<u32>,
}

pub fn info(git: &Git, repo: &Path) -> Result<RemoteInfo, GitError> {
    let remotes = list(git, repo)?;
    let upstream_remote = match current_branch(git, repo)? {
        Some(branch) => config_get(git, repo, &format!("branch.{branch}.remote"))?,
        None => None,
    };
    let default_remote = upstream_remote
        .filter(|r| remotes.iter().any(|remote| &remote.name == r))
        .or_else(|| {
            remotes
                .iter()
                .find(|r| r.name == "origin")
                .or(remotes.first())
                .map(|r| r.name.clone())
        });
    Ok(RemoteInfo {
        remotes,
        default_remote,
        last_fetched_at: last_fetched_at(git, repo)?,
    })
}

fn list(git: &Git, repo: &Path) -> Result<Vec<Remote>, GitError> {
    // Exit code 1 means no remotes.
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["config", "-z", "--get-regexp", r"^remote\..*\.url$"])
        .run_unchecked()?;
    if !output.success() && output.code != Some(1) {
        return Err(GitError::failed(output.code, output.failure_text()));
    }
    Ok(parse_remote_urls(&output.stdout_str()))
}

/// Parses `remote.<name>.url\n<url>\0` records. Names may contain dots.
fn parse_remote_urls(output: &str) -> Vec<Remote> {
    let mut remotes: Vec<Remote> = Vec::new();
    for record in output.split('\0') {
        let Some((key, url)) = record.split_once('\n') else {
            continue;
        };
        let Some(name) = key
            .strip_prefix("remote.")
            .and_then(|k| k.strip_suffix(".url"))
        else {
            continue;
        };
        // A remote can list several URLs; the first is the fetch URL.
        if !remotes.iter().any(|r| r.name == name) {
            remotes.push(Remote {
                name: name.to_owned(),
                url: url.to_owned(),
            });
        }
    }
    remotes
}

/// Modification time of `FETCH_HEAD`, which every fetch rewrites.
fn last_fetched_at(git: &Git, repo: &Path) -> Result<Option<u32>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--git-path", "FETCH_HEAD"])
        .run()?;
    let path = PathBuf::from(output.stdout_str().trim());
    let path = if path.is_absolute() {
        path
    } else {
        repo.join(path)
    };
    Ok(std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .and_then(|d| u32::try_from(d.as_secs()).ok()))
}

/// Downloads new commits and branches from `remote`, removing remote
/// branches that were deleted there.
pub fn fetch(
    git: &Git,
    repo: &Path,
    remote: &str,
    cancel: &CancelToken,
    on_progress: impl FnMut(Progress),
) -> Result<(), GitError> {
    let command = git
        .command()
        .cwd(repo)
        .args(["fetch", "--progress", "--prune", "--"])
        .arg(remote);
    transfer(command, TransferKind::Fetch, cancel, on_progress)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum PullOutcome {
    UpToDate,
    Updated,
    /// Pulled, but putting the stashed local changes back conflicted: the
    /// conflicts are in the working tree, the changes still in the stash.
    UpdatedWithConflicts,
}

/// Brings the current branch up to date with its upstream.
///
/// Works like `git pull`, split in two so the network part can be
/// cancelled: fetch the upstream's remote, then merge or rebase locally.
/// Follows `branch.<name>.rebase`, `pull.rebase` and `pull.ff`; without
/// them it merges, so diverged branches never stop with git's "how to
/// reconcile" question.
///
/// Local changes that would get in the way stop it with
/// [`crate::ErrorKind::PullBlockedByLocalChanges`]; with `autostash` they
/// are stashed first and put back afterwards.
pub fn pull(
    git: &Git,
    repo: &Path,
    autostash: bool,
    cancel: &CancelToken,
    on_progress: impl FnMut(Progress),
) -> Result<PullOutcome, GitError> {
    let branch = current_branch(git, repo)?.ok_or(GitError::DetachedHead)?;
    let remote =
        config_get(git, repo, &format!("branch.{branch}.remote"))?.ok_or(GitError::NoUpstream)?;
    // "." means the upstream is another local branch: nothing to fetch.
    if remote != "." {
        fetch(git, repo, &remote, cancel, on_progress)?;
    }
    if cancel.is_cancelled() {
        return Err(GitError::Cancelled);
    }
    if rev_parse(git, repo, "@{upstream}")?.is_none() {
        return Err(GitError::RemoteBranchNotFound);
    }

    let before = rev_parse(git, repo, "HEAD")?;
    let rebase = config_get(git, repo, &format!("branch.{branch}.rebase"))?
        .or(config_get(git, repo, "pull.rebase")?)
        .map(|v| v.to_ascii_lowercase());
    let command = git.command().cwd(repo);
    let command = match rebase.as_deref() {
        Some("merges" | "m") => command.args(["rebase", "--rebase-merges"]),
        // Interactive rebases need an editor; rebase plainly instead.
        Some("true" | "yes" | "on" | "1" | "interactive" | "i") => command.arg("rebase"),
        _ => {
            let command = command.args(["merge", "--no-edit"]);
            match config_get(git, repo, "pull.ff")?.as_deref() {
                Some("only") => command.arg("--ff-only"),
                Some("false") => command.arg("--no-ff"),
                _ => command,
            }
            .arg("@{upstream}")
        }
    };
    let command = if autostash {
        command.arg("--autostash")
    } else {
        command
    };
    let output = command.run().map_err(blocked_by_local_changes)?;

    let after = rev_parse(git, repo, "HEAD")?;
    let text = format!("{}{}", output.stdout_str(), output.stderr_str()).to_ascii_lowercase();
    Ok(
        if text.contains("applying autostash resulted in conflicts") {
            PullOutcome::UpdatedWithConflicts
        } else if before == after {
            PullOutcome::UpToDate
        } else {
            PullOutcome::Updated
        },
    )
}

/// git refuses a merge over local changes it would touch (or any staged
/// ones), and a rebase over any change at all; both say so differently.
fn blocked_by_local_changes(err: GitError) -> GitError {
    match err {
        GitError::Failed { kind, code, stderr }
            if kind == crate::ErrorKind::LocalChangesWouldBeOverwritten
                || stderr.to_ascii_lowercase().contains("cannot rebase:") =>
        {
            GitError::Failed {
                kind: crate::ErrorKind::PullBlockedByLocalChanges,
                code,
                stderr,
            }
        }
        other => other,
    }
}

/// Pushes the current branch to its upstream branch.
pub fn push(
    git: &Git,
    repo: &Path,
    cancel: &CancelToken,
    on_progress: impl FnMut(Progress),
) -> Result<(), GitError> {
    let branch = current_branch(git, repo)?.ok_or(GitError::DetachedHead)?;
    let remote =
        config_get(git, repo, &format!("branch.{branch}.remote"))?.ok_or(GitError::NoUpstream)?;
    let merge =
        config_get(git, repo, &format!("branch.{branch}.merge"))?.ok_or(GitError::NoUpstream)?;
    // An explicit refspec pushes to the upstream even when its name
    // differs, whatever `push.default` says.
    let command = git
        .command()
        .cwd(repo)
        .args(["push", "--progress", "--"])
        .arg(&remote)
        .arg(format!("refs/heads/{branch}:{merge}"));
    transfer(command, TransferKind::Push, cancel, on_progress)
}

/// Pushes the current branch to a branch of the same name on `remote` and
/// makes that its upstream.
pub fn publish(
    git: &Git,
    repo: &Path,
    remote: &str,
    cancel: &CancelToken,
    on_progress: impl FnMut(Progress),
) -> Result<(), GitError> {
    let branch = current_branch(git, repo)?.ok_or(GitError::DetachedHead)?;
    if !list(git, repo)?.iter().any(|r| r.name == remote) {
        return Err(GitError::NoRemote);
    }
    let command = git
        .command()
        .cwd(repo)
        .args(["push", "--progress", "--set-upstream", "--"])
        .arg(remote)
        .arg(format!("refs/heads/{branch}:refs/heads/{branch}"));
    transfer(command, TransferKind::Push, cancel, on_progress)
}

fn transfer(
    command: GitCommand<'_>,
    kind: TransferKind,
    cancel: &CancelToken,
    mut on_progress: impl FnMut(Progress),
) -> Result<(), GitError> {
    let mut parser = ProgressParser::for_kind(kind);
    command.run_streaming(cancel, |line| {
        if let Some(progress) = parser.feed(line) {
            on_progress(progress);
        }
    })?;
    Ok(())
}

/// The checked-out branch, or `None` when HEAD is detached.
fn current_branch(git: &Git, repo: &Path) -> Result<Option<String>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["symbolic-ref", "--quiet", "--short", "HEAD"])
        .run_unchecked()?;
    Ok(output
        .success()
        .then(|| output.stdout_str().trim().to_owned()))
}

/// A config value, or `None` if it isn't set.
fn config_get(git: &Git, repo: &Path, key: &str) -> Result<Option<String>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["config", "--get", key])
        .run_unchecked()?;
    match output.code {
        Some(0) => Ok(Some(output.stdout_str().trim().to_owned())),
        Some(1) => Ok(None),
        _ => Err(GitError::failed(output.code, output.failure_text())),
    }
}

fn rev_parse(git: &Git, repo: &Path, rev: &str) -> Result<Option<String>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--quiet", "--verify", rev])
        .run_unchecked()?;
    Ok(output
        .success()
        .then(|| output.stdout_str().trim().to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_remote_urls() {
        let out = "remote.origin.url\nhttps://example.com/a.git\0\
                   remote.my.fork.url\ngit@example.com:me/a.git\0\
                   remote.origin.url\nhttps://mirror.example.com/a.git\0";
        assert_eq!(
            parse_remote_urls(out),
            vec![
                Remote {
                    name: "origin".into(),
                    url: "https://example.com/a.git".into(),
                },
                Remote {
                    name: "my.fork".into(),
                    url: "git@example.com:me/a.git".into(),
                },
            ]
        );
        assert!(parse_remote_urls("").is_empty());
    }
}
