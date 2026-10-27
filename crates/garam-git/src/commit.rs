//! Creating commits and reading HEAD.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Git, GitError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CoAuthor {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HeadCommit {
    pub oid: String,
    pub summary: String,
    pub body: String,
}

/// Builds a commit message: summary, blank line, description, then
/// `Co-authored-by` trailers.
pub fn format_message(summary: &str, description: &str, co_authors: &[CoAuthor]) -> String {
    let mut message = summary.trim().to_owned();
    let description = description.trim();
    if !description.is_empty() {
        message.push_str("\n\n");
        message.push_str(description);
    }
    if !co_authors.is_empty() {
        message.push_str("\n\n");
        let trailers: Vec<String> = co_authors
            .iter()
            .map(|a| format!("Co-authored-by: {} <{}>", a.name.trim(), a.email.trim()))
            .collect();
        message.push_str(&trailers.join("\n"));
    }
    message.push('\n');
    message
}

/// Commits the index with `message`. Returns the new commit's id.
pub fn commit(git: &Git, repo: &Path, message: &str, amend: bool) -> Result<String, GitError> {
    let mut command =
        git.command()
            .cwd(repo)
            .args(["commit", "--quiet", "--cleanup=whitespace", "--file=-"]);
    if amend {
        command = command.arg("--amend");
    }
    command.stdin(message.as_bytes().to_vec()).run()?;
    head_oid(git, repo)?.ok_or_else(|| GitError::Parse("no HEAD after commit".into()))
}

/// HEAD's commit id, or `None` on a branch without commits.
pub fn head_oid(git: &Git, repo: &Path) -> Result<Option<String>, GitError> {
    resolve_commit(git, repo, "HEAD")
}

/// The commit `rev` names, or `None` if it names none. `rev` is never read
/// as an option.
pub(crate) fn resolve_commit(
    git: &Git,
    repo: &Path,
    rev: &str,
) -> Result<Option<String>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--verify", "--quiet", "--end-of-options"])
        .arg(format!("{rev}^{{commit}}"))
        .run_unchecked()?;
    match output.code {
        Some(0) => Ok(Some(output.stdout_str().trim().to_owned())),
        Some(1) => Ok(None),
        _ => Err(GitError::failed(output.code, output.failure_text())),
    }
}

/// The last commit, used to prefill the form when amending.
pub fn head_commit(git: &Git, repo: &Path) -> Result<Option<HeadCommit>, GitError> {
    if head_oid(git, repo)?.is_none() {
        return Ok(None);
    }
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["log", "-1", "--format=%H%x00%s%x00%b"])
        .run()?;
    let text = output.stdout_str();
    let mut parts = text.splitn(3, '\0');
    let (Some(oid), Some(summary), Some(body)) = (parts.next(), parts.next(), parts.next()) else {
        return Err(GitError::Parse(format!("log output: {text:?}")));
    };
    Ok(Some(HeadCommit {
        oid: oid.to_owned(),
        summary: summary.to_owned(),
        body: body.trim_end().to_owned(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_message_parts() {
        assert_eq!(format_message("  Fix bug ", "", &[]), "Fix bug\n");
        assert_eq!(
            format_message("Fix bug", "Longer\nexplanation\n", &[]),
            "Fix bug\n\nLonger\nexplanation\n"
        );
        let authors = [CoAuthor {
            name: "김가람".into(),
            email: "garam@example.com".into(),
        }];
        assert_eq!(
            format_message("Pair work", "", &authors),
            "Pair work\n\nCo-authored-by: 김가람 <garam@example.com>\n"
        );
        assert_eq!(
            format_message("Pair work", "Details", &authors),
            "Pair work\n\nDetails\n\nCo-authored-by: 김가람 <garam@example.com>\n"
        );
    }
}
