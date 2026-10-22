use std::path::Path;

use garam_git::commit::HeadCommit;
use garam_git::compare::{self, CompareMode, Comparison, LostCommit};
use garam_git::diff::FileDiff;
use garam_git::log::{
    self, CommitDetail, CommitFile, CommitSummary, HistoryFilter, HistoryMarkers, ResetMode,
    Signature,
};
use garam_git::{ChangeKind, Git, blob, tag};

use super::changes::{ImageVersions, data_url};
use crate::error::{AppError, AppErrorKind, AppResult, blocking};

/// A page of the history `filter` selects, newest first.
#[tauri::command]
#[specta::specta]
pub async fn history_list(
    repo: String,
    filter: HistoryFilter,
    skip: u32,
    limit: u32,
) -> AppResult<Vec<CommitSummary>> {
    blocking(move || {
        Ok(log::list(
            &Git::locate()?,
            Path::new(&repo),
            &filter,
            skip,
            limit,
        )?)
    })
    .await
}

/// Refs, unpushed and incoming commits, shown alongside the history.
#[tauri::command]
#[specta::specta]
pub async fn history_markers(repo: String) -> AppResult<HistoryMarkers> {
    blocking(move || Ok(log::markers(&Git::locate()?, Path::new(&repo))?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn commit_detail(repo: String, oid: String) -> AppResult<CommitDetail> {
    blocking(move || Ok(log::detail(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn commit_file_diff(
    repo: String,
    oid: String,
    file: CommitFile,
    ignore_whitespace: bool,
) -> AppResult<FileDiff> {
    blocking(move || {
        Ok(log::file_diff(
            &Git::locate()?,
            Path::new(&repo),
            &oid,
            &file,
            ignore_whitespace,
        )?)
    })
    .await
}

/// An image file before and after `oid`, for side-by-side preview.
#[tauri::command]
#[specta::specta]
pub async fn commit_images(
    repo: String,
    oid: String,
    file: CommitFile,
) -> AppResult<ImageVersions> {
    blocking(move || {
        let (git, repo) = (Git::locate()?, Path::new(&repo));
        let parent = log::first_parent(&git, repo, &oid)?;
        images_between(&git, repo, parent.as_deref(), &oid, &file)
    })
    .await
}

/// An image file at the two ends of a comparison.
#[tauri::command]
#[specta::specta]
pub async fn compare_images(
    repo: String,
    from: String,
    target: String,
    file: CommitFile,
) -> AppResult<ImageVersions> {
    blocking(move || {
        let (git, repo) = (Git::locate()?, Path::new(&repo));
        images_between(&git, repo, Some(&from), &target, &file)
    })
    .await
}

/// `file` in commit `from` (if any) and in `to`, as data URLs.
fn images_between(
    git: &Git,
    repo: &Path,
    from: Option<&str>,
    to: &str,
    file: &CommitFile,
) -> AppResult<ImageVersions> {
    let before = match (file.kind, from) {
        (ChangeKind::Added, _) | (_, None) => None,
        (_, Some(from)) => {
            let path = file.orig_path.as_deref().unwrap_or(&file.path);
            blob::blob_at(git, repo, from, path)?.and_then(|b| data_url(path, &b))
        }
    };
    let after = match file.kind {
        ChangeKind::Deleted => None,
        _ => blob::blob_at(git, repo, to, &file.path)?.and_then(|b| data_url(&file.path, &b)),
    };
    Ok(ImageVersions { before, after })
}

/// Whether `oid` is signed, and by whom. May run gpg, so it's asked for
/// separately from the commit's details.
#[tauri::command]
#[specta::specta]
pub async fn commit_signature(repo: String, oid: String) -> AppResult<Signature> {
    blocking(move || Ok(log::signature(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

/// `oid` as a patch `git am` can apply.
#[tauri::command]
#[specta::specta]
pub async fn commit_patch(repo: String, oid: String) -> AppResult<String> {
    blocking(move || Ok(log::patch(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

/// Writes `oid`'s patch to `path`, a file the user picked in a save dialog.
#[tauri::command]
#[specta::specta]
pub async fn commit_patch_save(repo: String, oid: String, path: String) -> AppResult<()> {
    blocking(move || {
        let patch = log::patch(&Git::locate()?, Path::new(&repo), &oid)?;
        std::fs::write(&path, patch)
            .map_err(|e| AppError::app(AppErrorKind::SaveFailed, e.to_string()))
    })
    .await
}

/// Adds a commit that undoes `oid`.
#[tauri::command]
#[specta::specta]
pub async fn commit_revert(repo: String, oid: String) -> AppResult<()> {
    blocking(move || Ok(log::revert(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

/// Applies `oid`'s changes as a new commit on HEAD.
#[tauri::command]
#[specta::specta]
pub async fn commit_cherry_pick(repo: String, oid: String) -> AppResult<()> {
    blocking(move || Ok(log::cherry_pick(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

/// Moves the current branch to `oid`.
#[tauri::command]
#[specta::specta]
pub async fn commit_reset(repo: String, oid: String, mode: ResetMode) -> AppResult<()> {
    blocking(move || Ok(log::reset(&Git::locate()?, Path::new(&repo), &oid, mode)?)).await
}

/// Undoes the last commit (`oid`), returning its message.
#[tauri::command]
#[specta::specta]
pub async fn commit_undo(repo: String, oid: String) -> AppResult<HeadCommit> {
    blocking(move || {
        Ok(log::undo_last_commit(
            &Git::locate()?,
            Path::new(&repo),
            &oid,
        )?)
    })
    .await
}

/// Checks out `oid` on a detached HEAD.
#[tauri::command]
#[specta::specta]
pub async fn commit_checkout(repo: String, oid: String) -> AppResult<()> {
    blocking(move || Ok(log::checkout(&Git::locate()?, Path::new(&repo), &oid)?)).await
}

/// Tags `oid`; annotated when `message` is given.
#[tauri::command]
#[specta::specta]
pub async fn tag_create(
    repo: String,
    name: String,
    oid: String,
    message: Option<String>,
) -> AppResult<()> {
    blocking(move || {
        Ok(tag::create(
            &Git::locate()?,
            Path::new(&repo),
            &name,
            &oid,
            message.as_deref(),
        )?)
    })
    .await
}

/// Compares two commits or branches (commit ids or full ref names).
#[tauri::command]
#[specta::specta]
pub async fn compare_get(
    repo: String,
    base: String,
    target: String,
    mode: CompareMode,
) -> AppResult<Comparison> {
    blocking(move || {
        Ok(compare::compare(
            &Git::locate()?,
            Path::new(&repo),
            &base,
            &target,
            mode,
        )?)
    })
    .await
}

/// One file's diff in a comparison.
#[tauri::command]
#[specta::specta]
pub async fn compare_file_diff(
    repo: String,
    from: String,
    target: String,
    file: CommitFile,
    ignore_whitespace: bool,
) -> AppResult<FileDiff> {
    blocking(move || {
        Ok(compare::file_diff(
            &Git::locate()?,
            Path::new(&repo),
            &from,
            &target,
            &file,
            ignore_whitespace,
        )?)
    })
    .await
}

/// Commits HEAD was on that no branch, tag or remote branch holds now.
#[tauri::command]
#[specta::specta]
pub async fn lost_commits(repo: String) -> AppResult<Vec<LostCommit>> {
    blocking(move || Ok(compare::lost_commits(&Git::locate()?, Path::new(&repo))?)).await
}
