//! git's commit-graph file, a cache of commit parents and generation
//! numbers. Without it, `git log --topo-order` reads every commit before it
//! prints the first one: about 1.5 s per history page with 500k commits,
//! against 15 ms with it. `git clone` doesn't write one, and `git gc` only
//! does when it runs.
//!
//! Commits made or fetched after the file was written aren't in it, and
//! each costs a little on every page (20k of them on top of 500k: 40 ms
//! instead of 10 ms). So new commits are added as a small extra layer
//! (`--split`, the way `fetch.writeCommitGraph` does) instead of
//! rewriting the whole file.

use std::path::{Path, PathBuf};

use crate::{Git, GitError};

/// Writes the commit-graph file if the repository has none, or adds the
/// commits it is missing, so history pages load quickly. Returns whether
/// it wrote the file from scratch.
///
/// Leaves repositories alone that turned it off with
/// `core.commitGraph=false`. Changed-path filters (`--changed-paths`) are
/// not written: they speed up path-filtered history but take about ten
/// times longer to build.
pub fn update(git: &Git, repo: &Path) -> Result<bool, GitError> {
    if !enabled(git, repo)? {
        return Ok(false);
    }
    if exists(git, repo)? {
        add_new_commits(git, repo)?;
        return Ok(false);
    }
    git.command()
        .cwd(repo)
        .args(["commit-graph", "write", "--reachable", "--no-progress"])
        .run()?;
    Ok(true)
}

/// Adds the commits the existing commit-graph is missing, e.g. after a
/// fetch. Does nothing without one: [`update`] writes it the first time
/// history is shown. Cheap: about 60 ms for 20k new commits on top of
/// 500k, and the file is left as it is when nothing is new.
pub fn append(git: &Git, repo: &Path) -> Result<(), GitError> {
    if enabled(git, repo)? && exists(git, repo)? {
        add_new_commits(git, repo)?;
    }
    Ok(())
}

/// Turns a single commit-graph file into a chain the first time, which
/// git reads the same way.
fn add_new_commits(git: &Git, repo: &Path) -> Result<(), GitError> {
    git.command()
        .cwd(repo)
        .args([
            "commit-graph",
            "write",
            "--reachable",
            "--split",
            "--no-progress",
        ])
        .run()?;
    Ok(())
}

/// Whether the repository has a commit-graph file.
pub fn exists(git: &Git, repo: &Path) -> Result<bool, GitError> {
    let info = objects_info_dir(git, repo)?;
    Ok(info.join("commit-graph").is_file()
        || info
            .join("commit-graphs")
            .join("commit-graph-chain")
            .is_file())
}

fn enabled(git: &Git, repo: &Path) -> Result<bool, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["config", "--type=bool", "--get", "core.commitGraph"])
        .run_unchecked()?;
    // Exit code 1 means unset, and git reads commit-graphs by default.
    Ok(output.stdout_str().trim() != "false")
}

/// `.git/objects/info`, wherever the object store lives (worktrees share
/// the main repository's).
fn objects_info_dir(git: &Git, repo: &Path) -> Result<PathBuf, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--git-path", "objects/info"])
        .run()?;
    let path = PathBuf::from(output.stdout_str().trim());
    Ok(if path.is_absolute() {
        path
    } else {
        repo.join(path)
    })
}
