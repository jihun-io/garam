//! Raw file contents, for image previews.

use std::path::Path;

use crate::{Git, GitError};

/// Contents of `path` in HEAD, or `None` if HEAD doesn't have it.
pub fn head_blob(git: &Git, repo: &Path, path: &str) -> Result<Option<Vec<u8>>, GitError> {
    blob_at(git, repo, "HEAD", path)
}

/// Contents of `path` in commit `rev`, or `None` if it doesn't have it.
pub fn blob_at(git: &Git, repo: &Path, rev: &str, path: &str) -> Result<Option<Vec<u8>>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["cat-file", "blob", "--end-of-options"])
        .arg(format!("{rev}:{path}"))
        .run_unchecked()?;
    Ok(output.success().then_some(output.stdout))
}
