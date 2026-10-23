//! Local help for opening a pull request: the repository's template.

use std::path::Path;

use crate::{Git, GitError, blob};

/// Folders GitHub looks in for a pull request template, in its order.
const TEMPLATE_DIRS: [&str; 3] = [".github", "", "docs"];
const TEMPLATE_NAME: &str = "pull_request_template.md";

/// The pull request template on `base` (a full ref like
/// `refs/remotes/origin/main`, or a commit id), as GitHub fills it in on
/// the web: `pull_request_template.md` in `.github/`, the root or `docs/`,
/// with any letter case. `None` when there's no template.
pub fn template(git: &Git, repo: &Path, base: &str) -> Result<Option<String>, GitError> {
    let Some(base) = crate::commit::resolve_commit(git, repo, base)? else {
        return Ok(None);
    };
    // Files in the folders, then at the root (a root listing isn't recursive).
    let nested = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["ls-tree", "-z", "--name-only", "-r", &base, "--"])
        .args(TEMPLATE_DIRS.iter().filter(|dir| !dir.is_empty()))
        .run()?
        .stdout_str()
        .into_owned();
    let root = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["ls-tree", "-z", "--name-only", &base])
        .run()?
        .stdout_str()
        .into_owned();
    let paths: Vec<&str> = nested
        .split('\0')
        .chain(root.split('\0'))
        .filter(|p| !p.is_empty())
        .collect();

    for dir in TEMPLATE_DIRS {
        let found = paths.iter().find(|path| {
            let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
            parent == dir && name.eq_ignore_ascii_case(TEMPLATE_NAME)
        });
        if let Some(path) = found {
            return Ok(blob::blob_at(git, repo, &base, path)?
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned()));
        }
    }
    Ok(None)
}
