use std::path::{Path, PathBuf};

use base64::Engine;
use garam_git::commit::{self, CoAuthor, HeadCommit};
use garam_git::diff::{self, FileDiff};
use garam_git::identity::{self, RepoIdentity};
use garam_git::patch::{self, LineRef};
use garam_git::precommit::{self, Finding};
use garam_git::{FileChange, Git, RepoStatus, blob, index, status};
use serde::Serialize;

use crate::error::{AppError, AppErrorKind, AppResult, blocking};

/// Images larger than this are not previewed.
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

#[tauri::command]
#[specta::specta]
pub async fn status_get(repo: String) -> AppResult<RepoStatus> {
    blocking(move || Ok(status::status(&Git::locate()?, Path::new(&repo))?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn diff_get(repo: String, file: FileChange) -> AppResult<FileDiff> {
    blocking(move || Ok(diff::file_diff(&Git::locate()?, Path::new(&repo), &file)?)).await
}

/// Before/after versions of an image as data URLs, for side-by-side preview.
#[derive(Debug, Serialize, specta::Type)]
pub struct ImageVersions {
    pub before: Option<String>,
    pub after: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn diff_images(repo: String, file: FileChange) -> AppResult<ImageVersions> {
    blocking(move || {
        let repo = PathBuf::from(repo);
        let git = Git::locate()?;
        let before = if file.exists_in_head() {
            let head_path = file.orig_path.as_deref().unwrap_or(&file.path);
            blob::head_blob(&git, &repo, head_path)?.and_then(|bytes| data_url(head_path, &bytes))
        } else {
            None
        };
        let after = std::fs::read(repo.join(&file.path))
            .ok()
            .and_then(|bytes| data_url(&file.path, &bytes));
        Ok(ImageVersions { before, after })
    })
    .await
}

pub(crate) fn data_url(path: &str, bytes: &[u8]) -> Option<String> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let ext = Path::new(path)
        .extension()?
        .to_string_lossy()
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => return None,
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
#[specta::specta]
pub async fn changes_stage(repo: String, files: Vec<FileChange>) -> AppResult<()> {
    blocking(move || Ok(index::stage(&Git::locate()?, Path::new(&repo), &files)?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn changes_unstage(repo: String, files: Vec<FileChange>) -> AppResult<()> {
    blocking(move || Ok(index::unstage(&Git::locate()?, Path::new(&repo), &files)?)).await
}

/// Makes the index contain exactly the `selected` changed lines of `file`.
#[tauri::command]
#[specta::specta]
pub async fn changes_stage_lines(
    repo: String,
    file: FileChange,
    selected: Vec<LineRef>,
) -> AppResult<()> {
    blocking(move || {
        Ok(patch::stage_lines(
            &Git::locate()?,
            Path::new(&repo),
            &file,
            &selected,
        )?)
    })
    .await
}

/// How many paths go to the system trash per request.
const TRASH_BATCH: usize = 500;

/// Reverts files to HEAD. Current contents go to the system trash first.
#[tauri::command]
#[specta::specta]
pub async fn changes_discard(repo: String, files: Vec<FileChange>) -> AppResult<()> {
    blocking(move || {
        let mut trash_error = None;
        let result = index::discard(&Git::locate()?, Path::new(&repo), &files, |paths| {
            // On macOS every trash call is a separate Finder request, so
            // trashing files one at a time crawls once there are thousands.
            // Chunks keep each request's argument list well below OS limits.
            for chunk in paths.chunks(TRASH_BATCH) {
                trash::delete_all(chunk).map_err(|e| {
                    trash_error = Some(e.to_string());
                    std::io::Error::other(e.to_string())
                })?;
            }
            Ok(())
        });
        if let Some(detail) = trash_error {
            return Err(AppError::app(AppErrorKind::TrashFailed, Some(detail)));
        }
        Ok(result?)
    })
    .await
}

/// Commits the index. Returns the new commit id.
#[tauri::command]
#[specta::specta]
pub async fn commit_create(
    repo: String,
    summary: String,
    description: String,
    co_authors: Vec<CoAuthor>,
    amend: bool,
) -> AppResult<String> {
    blocking(move || {
        let message = commit::format_message(&summary, &description, &co_authors);
        Ok(commit::commit(
            &Git::locate()?,
            Path::new(&repo),
            &message,
            amend,
        )?)
    })
    .await
}

/// What to warn about before committing the index: secrets, large files
/// and newly added files that are usually ignored.
#[tauri::command]
#[specta::specta]
pub async fn commit_check(repo: String) -> AppResult<Vec<Finding>> {
    blocking(move || Ok(precommit::check(&Git::locate()?, Path::new(&repo))?)).await
}

/// Adds `patterns` to the root `.gitignore` and leaves `paths` out of the
/// commit.
#[tauri::command]
#[specta::specta]
pub async fn commit_ignore(
    repo: String,
    patterns: Vec<String>,
    paths: Vec<String>,
) -> AppResult<()> {
    blocking(move || {
        Ok(precommit::ignore(
            &Git::locate()?,
            Path::new(&repo),
            &patterns,
            &paths,
        )?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn commit_head(repo: String) -> AppResult<Option<HeadCommit>> {
    blocking(move || Ok(commit::head_commit(&Git::locate()?, Path::new(&repo))?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn identity_get(repo: String) -> AppResult<RepoIdentity> {
    blocking(move || Ok(identity::get(&Git::locate()?, Path::new(&repo))?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn identity_set(name: String, email: String) -> AppResult<()> {
    blocking(move || Ok(identity::set_global(&Git::locate()?, &name, &email)?)).await
}

/// Overrides the global identity in `repo`'s own config.
#[tauri::command]
#[specta::specta]
pub async fn identity_set_local(repo: String, name: String, email: String) -> AppResult<()> {
    blocking(move || {
        Ok(identity::set_local(
            &Git::locate()?,
            Path::new(&repo),
            &name,
            &email,
        )?)
    })
    .await
}

/// Removes `repo`'s own identity so the global one applies again.
#[tauri::command]
#[specta::specta]
pub async fn identity_clear_local(repo: String) -> AppResult<()> {
    blocking(move || Ok(identity::clear_local(&Git::locate()?, Path::new(&repo))?)).await
}
