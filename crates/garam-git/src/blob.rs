//! Raw file contents, for image previews.

use std::path::Path;

use crate::{Git, GitError};

/// Contents of `path` in HEAD, or `None` if HEAD doesn't have it.
pub fn head_blob(git: &Git, repo: &Path, path: &str) -> Result<Option<Vec<u8>>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .arg("cat-file")
        .arg("blob")
        .arg(format!("HEAD:{path}"))
        .run_unchecked()?;
    Ok(output.success().then_some(output.stdout))
}
