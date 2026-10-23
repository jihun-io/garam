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
//!
//! Changed-path Bloom filters let a path-filtered history skip commits
//! that didn't touch the path without reading their trees: a path changed
//! nowhere in 500k commits takes 0.5 s instead of 3.6 s. They take about
//! four times longer to write, so they are added only once history is
//! filtered by a path ([`add_changed_paths`]). Layers added later keep
//! them on their own.
//!
//! Writes from this app to one repository take turns, so the one on
//! opening it and the one for a path filter don't trip over git's lock.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use crate::{Git, GitError};

/// One lock per object store (worktrees share their repository's).
static WRITING: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = LazyLock::new(Default::default);

fn write_lock(git: &Git, repo: &Path) -> Result<Arc<Mutex<()>>, GitError> {
    let info = objects_info_dir(git, repo)?;
    let info = info.canonicalize().unwrap_or(info);
    let mut locks = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    Ok(Arc::clone(locks.entry(info).or_default()))
}

/// Writes the commit-graph file if the repository has none, or adds the
/// commits it is missing, so history pages load quickly. Returns whether
/// it wrote the file from scratch.
///
/// Leaves repositories alone that turned it off with
/// `core.commitGraph=false`.
pub fn update(git: &Git, repo: &Path) -> Result<bool, GitError> {
    let lock = write_lock(git, repo)?;
    let _writing = lock.lock().unwrap_or_else(|e| e.into_inner());
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
/// 500k, and the file is left as it is when nothing is new. Skipped while
/// another write is running rather than waiting for it.
pub fn append(git: &Git, repo: &Path) -> Result<(), GitError> {
    let lock = write_lock(git, repo)?;
    let Ok(_writing) = lock.try_lock() else {
        return Ok(());
    };
    if enabled(git, repo)? && exists(git, repo)? {
        add_new_commits(git, repo)?;
    }
    Ok(())
}

/// Rewrites the commit-graph with changed-path Bloom filters, for history
/// filtered by a path, unless it has them already. Returns whether it
/// wrote them. Takes a while on a large repository (about 7 s for 500k
/// commits), so run it in the background.
pub fn add_changed_paths(git: &Git, repo: &Path) -> Result<bool, GitError> {
    let lock = write_lock(git, repo)?;
    let _writing = lock.lock().unwrap_or_else(|e| e.into_inner());
    if !enabled(git, repo)? || has_changed_paths(git, repo)? {
        return Ok(false);
    }
    git.command()
        .cwd(repo)
        .args([
            "commit-graph",
            "write",
            "--reachable",
            "--changed-paths",
            "--no-progress",
        ])
        .run()?;
    Ok(true)
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

/// Whether every layer of the commit-graph has changed-path Bloom filters.
pub fn has_changed_paths(git: &Git, repo: &Path) -> Result<bool, GitError> {
    let layers = layers(&objects_info_dir(git, repo)?);
    Ok(!layers.is_empty()
        && layers.iter().all(|layer| {
            chunk_ids(layer).is_some_and(|ids| ids.contains(b"BIDX") && ids.contains(b"BDAT"))
        }))
}

/// The commit-graph files: the single one, or each layer of a chain.
fn layers(info: &Path) -> Vec<PathBuf> {
    let single = info.join("commit-graph");
    if single.is_file() {
        return vec![single];
    }
    let dir = info.join("commit-graphs");
    std::fs::read_to_string(dir.join("commit-graph-chain"))
        .map(|chain| {
            chain
                .lines()
                .filter(|hash| !hash.is_empty())
                .map(|hash| dir.join(format!("graph-{hash}.graph")))
                .collect()
        })
        .unwrap_or_default()
}

/// The chunk ids in a commit-graph file's table of contents: an 8-byte
/// header whose seventh byte is the chunk count, then a 4-byte id and an
/// 8-byte offset per chunk.
fn chunk_ids(file: &Path) -> Option<Vec<[u8; 4]>> {
    let mut file = File::open(file).ok()?;
    let mut header = [0u8; 8];
    file.read_exact(&mut header).ok()?;
    if &header[..4] != b"CGPH" {
        return None;
    }
    let mut table = vec![0u8; usize::from(header[6]) * 12];
    file.read_exact(&mut table).ok()?;
    Some(
        table
            .as_chunks::<12>()
            .0
            .iter()
            .map(|entry| [entry[0], entry[1], entry[2], entry[3]])
            .collect(),
    )
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
