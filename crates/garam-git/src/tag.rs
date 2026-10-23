//! Tags.
//!
//! Tags made here are remembered as unpushed until a push sends them or
//! they are deleted, so a push can carry them along. Fetched tags look the
//! same as local ones in `refs/tags`, so without that list there is no way
//! to tell which tags the remote lacks short of asking it.

use std::fs;
use std::io::ErrorKind as IoErrorKind;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Git, GitError};

/// How the tag list is sorted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum TagOrder {
    /// Highest version first (`v1.10.0` before `v1.9.0`), a pre-release
    /// below its release (`v1.0.0` before `v1.0.0-rc.1`); names that
    /// aren't versions come last.
    Version,
    /// Most recently tagged first: an annotated tag's date, or a plain
    /// tag's commit date.
    Newest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    /// The tag object for an annotated tag, the commit for a plain one;
    /// what the remote's copy is compared with.
    pub oid: String,
    /// The commit it points at.
    pub target: String,
    pub annotated: bool,
    /// An annotated tag's first message line.
    pub message: Option<String>,
    /// The first line of the commit it points at.
    pub summary: String,
    /// Seconds since the Unix epoch.
    pub created_at: u32,
    /// Made here and not pushed yet.
    pub unpushed: bool,
}

/// Every tag in the repository.
pub fn list(git: &Git, repo: &Path, order: TagOrder) -> Result<Vec<Tag>, GitError> {
    // An annotated tag's own subject is its message; the commit's is
    // behind the `*` (peeled) fields. A plain tag's subject is the commit's.
    const FORMAT: &str = "%(refname:lstrip=2)%00%(objectname)%00%(*objectname)%00\
                          %(objecttype)%00%(creatordate:unix)%00%(*contents:subject)%00\
                          %(contents:subject)";
    let sort = match order {
        TagOrder::Version => "--sort=-v:refname",
        TagOrder::Newest => "--sort=-creatordate",
    };
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        // git puts `v1.0.0-rc.1` after `v1.0.0` unless told that a `-`
        // suffix marks a pre-release, the way SemVer reads it.
        .config("versionsort.suffix", "-")
        .args([
            "for-each-ref",
            sort,
            &format!("--format={FORMAT}"),
            "refs/tags",
        ])
        .run()?;
    let unpushed = read_unpushed(git, repo)?;
    Ok(output
        .stdout_str()
        .lines()
        .filter_map(|line| parse_tag(line, &unpushed))
        .collect())
}

fn parse_tag(line: &str, unpushed: &[String]) -> Option<Tag> {
    let fields: Vec<&str> = line.splitn(7, '\0').collect();
    let [name, oid, peeled, kind, date, peeled_subject, subject] = fields[..] else {
        return None;
    };
    let annotated = kind == "tag";
    Some(Tag {
        name: name.to_owned(),
        oid: oid.to_owned(),
        target: if peeled.is_empty() { oid } else { peeled }.to_owned(),
        annotated,
        message: (annotated && !subject.is_empty()).then(|| subject.to_owned()),
        summary: if annotated { peeled_subject } else { subject }.to_owned(),
        created_at: date.parse().unwrap_or(0),
        unpushed: unpushed.iter().any(|n| n == name),
    })
}

/// Checks a new tag name the way git does.
pub fn validate_name(git: &Git, name: &str) -> Result<(), GitError> {
    let output = git
        .command()
        .args(["check-ref-format", &format!("refs/tags/{name}")])
        .run_unchecked()?;
    if output.success() && !name.starts_with('-') {
        Ok(())
    } else {
        Err(GitError::InvalidTagName(name.to_owned()))
    }
}

/// Tags `oid` as `name`. With a message the tag is annotated (it records
/// who tagged and when); without one it is a plain name for the commit.
pub fn create(
    git: &Git,
    repo: &Path,
    name: &str,
    oid: &str,
    message: Option<&str>,
) -> Result<(), GitError> {
    validate_name(git, name)?;
    crate::log::check_oid(oid)?;
    let mut command = git.command().cwd(repo).arg("tag");
    let message = message.map(str::trim).filter(|m| !m.is_empty());
    if let Some(message) = message {
        command = command
            .args(["--annotate", "--file=-"])
            .stdin(message.as_bytes().to_vec());
    }
    command.args([name, oid]).run()?;
    let mut names = read_unpushed(git, repo)?;
    names.push(name.to_owned());
    write_unpushed(git, repo, &names)
}

/// Deletes the tag `name` from this repository only.
pub fn delete(git: &Git, repo: &Path, name: &str) -> Result<(), GitError> {
    git.command()
        .cwd(repo)
        .args(["tag", "--delete", "--", name])
        .run()?;
    forget(git, repo, &[name.to_owned()])
}

/// Tags made here that no push has sent yet, oldest first. Tags deleted
/// outside the app drop out.
pub fn unpushed(git: &Git, repo: &Path) -> Result<Vec<String>, GitError> {
    let names = read_unpushed(git, repo)?;
    if names.is_empty() {
        return Ok(names);
    }
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["for-each-ref", "--format=%(refname:lstrip=2)", "refs/tags"])
        .run()?;
    let stdout = output.stdout_str();
    let existing: Vec<&str> = stdout.lines().collect();
    Ok(names
        .into_iter()
        .filter(|name| existing.contains(&name.as_str()))
        .collect())
}

/// Takes `names` off the unpushed list (they were pushed or deleted).
pub fn forget(git: &Git, repo: &Path, names: &[String]) -> Result<(), GitError> {
    let mut list = read_unpushed(git, repo)?;
    let before = list.len();
    list.retain(|name| !names.contains(name));
    if list.len() == before {
        return Ok(());
    }
    write_unpushed(git, repo, &list)
}

/// `.git/garam/unpushed-tags`, in the main repository's git directory so
/// worktrees share it like they share tags.
fn unpushed_file(git: &Git, repo: &Path) -> Result<PathBuf, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", "--git-common-dir"])
        .run()?;
    let dir = PathBuf::from(output.stdout_str().trim());
    let dir = if dir.is_absolute() {
        dir
    } else {
        repo.join(dir)
    };
    Ok(dir.join("garam").join("unpushed-tags"))
}

fn read_unpushed(git: &Git, repo: &Path) -> Result<Vec<String>, GitError> {
    match fs::read_to_string(unpushed_file(git, repo)?) {
        Ok(text) => {
            let mut names: Vec<String> = Vec::new();
            for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
                if !names.iter().any(|n| n == line) {
                    names.push(line.to_owned());
                }
            }
            Ok(names)
        }
        Err(e) if e.kind() == IoErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

fn write_unpushed(git: &Git, repo: &Path, names: &[String]) -> Result<(), GitError> {
    let file = unpushed_file(git, repo)?;
    if names.is_empty() {
        return match fs::remove_file(&file) {
            Err(e) if e.kind() != IoErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        };
    }
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut text = names.join("\n");
    text.push('\n');
    // Write a sibling and rename it so a crash never leaves half a list.
    let temp = file.with_extension("tmp");
    fs::write(&temp, text)?;
    fs::rename(&temp, &file)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_and_annotated_tags() {
        let unpushed = ["v2".to_owned()];
        let plain = parse_tag(
            "v1\x00aaa\x00\x00commit\x001700000000\x00\x00Commit subject",
            &unpushed,
        )
        .unwrap();
        assert_eq!(plain.target, "aaa");
        assert!(!plain.annotated);
        assert_eq!(plain.message, None, "a plain tag has no message of its own");
        assert_eq!(plain.summary, "Commit subject");
        assert!(!plain.unpushed);

        let annotated = parse_tag(
            "v2\x00ttt\x00ccc\x00tag\x001700000100\x00Fix it\x00Release 2",
            &unpushed,
        )
        .unwrap();
        assert_eq!(annotated.oid, "ttt");
        assert_eq!(annotated.target, "ccc");
        assert_eq!(annotated.message.as_deref(), Some("Release 2"));
        assert_eq!(annotated.summary, "Fix it");
        assert_eq!(annotated.created_at, 1_700_000_100);
        assert!(annotated.unpushed);
    }
}
