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
/// branches that were deleted there, and adds the new commits to the
/// commit-graph file if there is one.
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
    transfer(command, TransferKind::Fetch, cancel, on_progress)?;
    // Only a cache: a failure (e.g. another git holding its lock) costs
    // a little speed until the next fetch.
    let _ = crate::commit_graph::append(git, repo);
    Ok(())
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
    command.run().map_err(blocked_by_local_changes)?;

    let after = rev_parse(git, repo, "HEAD")?;
    // git words the autostash conflict differently across versions, so
    // look at the index: a pull can't start with unmerged paths, so any
    // left now came from putting the stashed changes back.
    Ok(
        if autostash && !crate::conflict::unmerged(git, repo)?.is_empty() {
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
    push_with_tags(
        git,
        repo,
        &remote,
        &format!("refs/heads/{branch}:{merge}"),
        cancel,
        on_progress,
    )
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
    // `--set-upstream` applies only to the branch; tags have no upstream.
    let command = git
        .command()
        .cwd(repo)
        .args(["push", "--progress", "--set-upstream", "--"])
        .arg(remote)
        .arg(format!("refs/heads/{branch}:refs/heads/{branch}"));
    let tags = crate::tag::unpushed(git, repo)?;
    let command = command.args(tags.iter().map(|name| tag_refspec(name)));
    transfer(command, TransferKind::Push, cancel, on_progress)?;
    crate::tag::forget(git, repo, &tags)
}

/// Pushes `branch_refspec` to `remote` along with the tags made here that
/// aren't pushed yet, then takes those tags off the unpushed list. Tags are
/// named one by one, so lightweight tags go too and other local tags
/// (fetched ones, or ones made in a terminal) stay put.
fn push_with_tags(
    git: &Git,
    repo: &Path,
    remote: &str,
    branch_refspec: &str,
    cancel: &CancelToken,
    on_progress: impl FnMut(Progress),
) -> Result<(), GitError> {
    let tags = crate::tag::unpushed(git, repo)?;
    let command = git
        .command()
        .cwd(repo)
        .args(["push", "--progress", "--"])
        .arg(remote)
        .arg(branch_refspec)
        .args(tags.iter().map(|name| tag_refspec(name)));
    transfer(command, TransferKind::Push, cancel, on_progress)?;
    crate::tag::forget(git, repo, &tags)
}

fn tag_refspec(name: &str) -> String {
    format!("refs/tags/{name}:refs/tags/{name}")
}

/// How a local tag compares with the remote's tag of the same name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum TagSync {
    Same,
    /// The remote's tag points elsewhere, or was made again.
    Differs,
    /// Not pushed yet, or deleted on the remote: fetching keeps tags the
    /// remote dropped.
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TagState {
    pub name: String,
    pub sync: TagSync,
}

/// How each local tag compares with `remote`'s, by tag object id
/// (`ls-remote --tags --refs`).
pub fn tag_states(
    git: &Git,
    repo: &Path,
    remote: &str,
    cancel: &CancelToken,
) -> Result<Vec<TagState>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .args(["ls-remote", "--tags", "--refs", "--"])
        .arg(remote)
        .run_streaming(cancel, |_| {})?;
    let stdout = output.stdout_str();
    let remote_tags: Vec<(&str, &str)> = stdout
        .lines()
        .filter_map(|line| {
            let (oid, refname) = line.split_once('\t')?;
            Some((refname.strip_prefix("refs/tags/")?, oid))
        })
        .collect();
    Ok(crate::tag::list(git, repo, crate::tag::TagOrder::Version)?
        .into_iter()
        .map(|tag| {
            let sync = match remote_tags.iter().find(|(name, _)| *name == tag.name) {
                Some((_, oid)) if *oid == tag.oid => TagSync::Same,
                Some(_) => TagSync::Differs,
                None => TagSync::Missing,
            };
            TagState {
                name: tag.name,
                sync,
            }
        })
        .collect())
}

/// Pushes the tags `names` to `remote`, and with `force` replaces the
/// remote's tags of the same names. Without it, a remote tag pointing
/// elsewhere is [`crate::ErrorKind::RemoteTagExists`]. Pushed tags leave
/// the unpushed list.
pub fn push_tags(
    git: &Git,
    repo: &Path,
    remote: &str,
    names: &[String],
    force: bool,
    cancel: &CancelToken,
    on_progress: impl FnMut(Progress),
) -> Result<(), GitError> {
    for name in names {
        crate::tag::validate_name(git, name)?;
    }
    let plus = if force { "+" } else { "" };
    let command = git
        .command()
        .cwd(repo)
        .args(["push", "--progress", "--"])
        .arg(remote)
        .args(
            names
                .iter()
                .map(|name| format!("{plus}{}", tag_refspec(name))),
        );
    transfer(command, TransferKind::Push, cancel, on_progress)?;
    crate::tag::forget(git, repo, names)
}

/// Deletes the tag `name` on `remote`. A tag the remote doesn't have
/// counts as deleted.
pub fn delete_tag(
    git: &Git,
    repo: &Path,
    remote: &str,
    name: &str,
    cancel: &CancelToken,
) -> Result<(), GitError> {
    let command = git
        .command()
        .cwd(repo)
        .args(["push", "--progress", "--"])
        .arg(remote)
        .arg(format!(":refs/tags/{name}"));
    match transfer(command, TransferKind::Push, cancel, |_| {}) {
        Err(GitError::Failed { stderr, .. })
            if stderr
                .to_ascii_lowercase()
                .contains("remote ref does not exist") =>
        {
            Ok(())
        }
        other => other,
    }
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

/// The remote's default branch as the last clone or fetch saw it
/// (`refs/remotes/<remote>/HEAD`), e.g. `main`. `None` when git never
/// recorded it, as in a repository whose remote was added by hand.
pub fn default_branch(git: &Git, repo: &Path, remote: &str) -> Result<Option<String>, GitError> {
    let prefix = format!("refs/remotes/{remote}/");
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["symbolic-ref", "--quiet", "--end-of-options"])
        .arg(format!("{prefix}HEAD"))
        .run_unchecked()?;
    Ok(output
        .success()
        .then(|| output.stdout_str().trim().to_owned())
        .and_then(|target| target.strip_prefix(&prefix).map(str::to_owned))
        .filter(|branch| !branch.is_empty()))
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
