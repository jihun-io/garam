//! Editing the latest unpublished commit with a private index. Neither HEAD,
//! the real index nor working files change until Save; Cancel discards only
//! the private index. All reads and selections use the commit's first parent.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::commit::{self, HeadCommit};
use crate::diff::{self, FileDiff};
use crate::patch::{self, LineRef};
use crate::{
    ChangeKind, FileChange, Git, GitError, RepoStatus, conflict, index, log, precommit, status,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AmendSession {
    pub id: String,
    pub head: HeadCommit,
}

#[derive(Serialize, Deserialize)]
struct Saved {
    session: AmendSession,
    branch: String,
    base: String,
    original_tree: String,
}

fn directory(git: &Git, repo: &Path, id: &str) -> Result<PathBuf, GitError> {
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(GitError::CannotAmend);
    }
    let dir = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--absolute-git-dir"])
        .run()?;
    Ok(Path::new(dir.stdout_str().trim())
        .join("garam")
        .join(format!("amend-{id}")))
}

fn index_path(git: &Git, repo: &Path) -> Result<PathBuf, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--path-format=absolute", "--git-path", "index"])
        .run()?;
    Ok(PathBuf::from(output.stdout_str().trim()))
}

fn tree(git: &Git, repo: &Path) -> Result<String, GitError> {
    Ok(git
        .command()
        .cwd(repo)
        .arg("write-tree")
        .run()?
        .stdout_str()
        .trim()
        .to_owned())
}

fn validate(git: &Git, repo: &Path, saved: &Saved) -> Result<(), GitError> {
    let branch = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["symbolic-ref", "--quiet", "HEAD"])
        .run_unchecked()?;
    if !branch.success()
        || branch.stdout_str().trim() != saved.branch
        || commit::head_oid(git, repo)?.as_deref() != Some(saved.session.head.oid.as_str())
    {
        return Err(GitError::HeadMoved);
    }
    let state = conflict::state(git, repo)?;
    if state.operation.is_some() || !state.files.is_empty() {
        return Err(GitError::CannotAmend);
    }
    let published = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "for-each-ref",
            "--format=%(refname)",
            &format!("--contains={}", saved.session.head.oid),
            "refs/remotes",
        ])
        .run()?;
    if !published.stdout.is_empty() {
        return Err(GitError::CannotAmend);
    }
    Ok(())
}

fn load(git: &Git, repo: &Path, id: &str) -> Result<(Saved, Git, PathBuf), GitError> {
    let dir = directory(git, repo, id)?;
    let saved: Saved = serde_json::from_slice(&fs::read(dir.join("session.json"))?)
        .map_err(|err| GitError::Parse(err.to_string()))?;
    if saved.session.id != id {
        return Err(GitError::CannotAmend);
    }
    validate(git, repo, &saved)?;
    let editing = git
        .clone()
        .with_env("GIT_INDEX_FILE", dir.join("index"))
        .with_config("status.renames", "false");
    Ok((saved, editing, dir))
}

pub fn begin(git: &Git, repo: &Path, expected_head: &str) -> Result<AmendSession, GitError> {
    let head = commit::head_commit(git, repo)?.ok_or(GitError::CannotAmend)?;
    if head.oid != expected_head {
        return Err(GitError::HeadMoved);
    }
    let parents = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-list", "--parents", "-1", &head.oid])
        .run()?;
    let parents: Vec<_> = parents
        .stdout_str()
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    if parents.len() > 2 {
        return Err(GitError::CannotAmend);
    }
    let branch = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["symbolic-ref", "--quiet", "HEAD"])
        .run_unchecked()?;
    if branch.code == Some(1) {
        return Err(GitError::DetachedHead);
    }
    if !branch.success() {
        return Err(GitError::failed(branch.code, branch.failure_text()));
    }
    let id = format!(
        "{:x}{:x}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| GitError::Parse(e.to_string()))?
            .as_nanos()
    );
    let session = AmendSession { id, head };
    let saved = Saved {
        session: session.clone(),
        branch: branch.stdout_str().trim().to_owned(),
        base: match parents.get(1) {
            Some(parent) => parent.clone(),
            None => diff::empty_tree(git, repo)?,
        },
        original_tree: tree(git, repo)?,
    };
    validate(git, repo, &saved)?;
    let dir = directory(git, repo, &session.id)?;
    fs::create_dir_all(dir.parent().ok_or(GitError::CannotAmend)?)?;
    fs::create_dir(&dir)?;
    let result = (|| {
        // Preserve index flags (assume-unchanged, skip-worktree, intent-to-add)
        // as well as the staged tree. Make split indexes self-contained.
        fs::copy(index_path(git, repo)?, dir.join("index"))?;
        let editing = git.clone().with_env("GIT_INDEX_FILE", dir.join("index"));
        editing
            .command()
            .cwd(repo)
            .args(["update-index", "--no-split-index"])
            .run()?;
        if tree(&editing, repo)? != saved.original_tree {
            return Err(GitError::IndexChanged);
        }
        fs::write(
            dir.join("session.json"),
            serde_json::to_vec(&saved).map_err(|e| GitError::Parse(e.to_string()))?,
        )?;
        Ok(session)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&dir);
    }
    result
}

pub fn status(git: &Git, repo: &Path, id: &str) -> Result<RepoStatus, GitError> {
    let (saved, editing, _) = load(git, repo, id)?;
    let mut result = status::status(&editing, repo)?;
    let mut files: BTreeMap<String, FileChange> = BTreeMap::new();
    // Keep the private index -> worktree side; HEAD -> index is replaced by
    // parent -> index. Renames are separate paths so either side can be kept.
    for mut file in result.files {
        file.staged = None;
        file.orig_path = None;
        if file.unstaged.is_some() {
            files.insert(file.path.clone(), file);
        }
    }
    let staged = editing
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "diff",
            "--cached",
            "--name-status",
            "--no-renames",
            "-z",
            &saved.base,
            "--",
        ])
        .run()?;
    let submodules = editing
        .command()
        .cwd(repo)
        .read_only()
        .args(["ls-files", "--stage", "-z"])
        .run()?;
    let submodules: std::collections::HashSet<_> = submodules
        .stdout_str()
        .split('\0')
        .filter_map(|r| {
            r.strip_prefix("160000 ")
                .and_then(|r| r.split_once('\t').map(|(_, p)| p.to_owned()))
        })
        .collect();
    for staged in log::parse_name_status(&staged.stdout_str()) {
        let file = files.entry(staged.path.clone()).or_insert(FileChange {
            path: staged.path,
            orig_path: None,
            staged: None,
            unstaged: None,
            is_submodule: false,
        });
        file.staged = Some(staged.kind);
        file.is_submodule |= submodules.contains(&file.path);
    }
    let parent = editing
        .command()
        .cwd(repo)
        .read_only()
        .args(["ls-tree", "-r", "-z", &saved.base])
        .run()?;
    let parent_paths: std::collections::HashSet<_> = parent
        .stdout_str()
        .split('\0')
        .filter_map(|row| row.split_once('\t').map(|(_, path)| path.to_owned()))
        .collect();
    for file in files.values_mut() {
        if file.unstaged == Some(ChangeKind::Untracked) && parent_paths.contains(&file.path) {
            file.unstaged = Some(ChangeKind::Modified);
        }
    }
    result.files = files.into_values().collect();
    Ok(result)
}

pub fn file_diff(
    git: &Git,
    repo: &Path,
    id: &str,
    file: &FileChange,
) -> Result<FileDiff, GitError> {
    let (saved, editing, _) = load(git, repo, id)?;
    diff::file_diff_against(&editing, repo, file, &saved.base)
}

pub fn before_image(
    git: &Git,
    repo: &Path,
    id: &str,
    path: &str,
) -> Result<Option<Vec<u8>>, GitError> {
    let (saved, editing, _) = load(git, repo, id)?;
    crate::blob::blob_at(&editing, repo, &saved.base, path)
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AmendEdit {
    Files {
        files: Vec<FileChange>,
        include: bool,
    },
    Lines {
        file: FileChange,
        selected: Vec<LineRef>,
    },
}

pub fn edit(git: &Git, repo: &Path, id: &str, edit: AmendEdit) -> Result<(), GitError> {
    let (saved, editing, _) = load(git, repo, id)?;
    match edit {
        AmendEdit::Files {
            files,
            include: true,
        } => index::stage(&editing, repo, &files),
        AmendEdit::Files {
            files,
            include: false,
        } => index::unstage_against(&editing, repo, &files, &saved.base),
        AmendEdit::Lines { file, selected } => {
            patch::stage_lines_against(&editing, repo, &file, &selected, &saved.base)
        }
    }
}

pub fn check(git: &Git, repo: &Path, id: &str) -> Result<Vec<precommit::Finding>, GitError> {
    let (_, editing, _) = load(git, repo, id)?;
    precommit::check(&editing, repo)
}

/// Holds the real index lock across committing with the private index and
/// installing its result. A terminal cannot stage changes in that interval.
struct IndexLock(PathBuf);
impl Drop for IndexLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub fn save(git: &Git, repo: &Path, id: &str, message: &str) -> Result<String, GitError> {
    if message.trim().is_empty() || message.contains('\0') {
        return Err(GitError::CannotAmend);
    }
    let (saved, editing, dir) = load(git, repo, id)?;
    let index = index_path(git, repo)?;
    let lock = index.with_file_name("index.lock");
    let held = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)?;
    let guard = IndexLock(lock);
    // Compare trees using a copy while holding the real index lock. Merely
    // refreshing the real index's stat cache doesn't invalidate the editor.
    fs::copy(&index, dir.join("current-index"))?;
    let current = git
        .clone()
        .with_env("GIT_INDEX_FILE", dir.join("current-index"));
    if tree(&current, repo)? != saved.original_tree {
        return Err(GitError::IndexChanged);
    }
    validate(git, repo, &saved)?;
    // --allow-empty permits removing every change while keeping this commit.
    editing
        .command()
        .cwd(repo)
        .args([
            "commit",
            "--amend",
            "--allow-empty",
            "--quiet",
            "--cleanup=whitespace",
            "--file=-",
        ])
        .stdin(message.as_bytes())
        .run()?;
    fs::copy(dir.join("index"), &guard.0)?;
    drop(held);
    fs::rename(&guard.0, &index)?;
    let oid = commit::head_oid(git, repo)?.ok_or(GitError::CannotAmend)?;
    let _ = fs::remove_dir_all(dir);
    Ok(oid)
}

pub fn cancel(git: &Git, repo: &Path, id: &str) -> Result<(), GitError> {
    // Always allow cancel, including after HEAD moved elsewhere.
    let dir = directory(git, repo, id)?;
    if dir.exists() {
        fs::remove_dir_all(dir)?;
    }
    Ok(())
}
