//! Working tree status from `git status --porcelain=v2 -z --branch`.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Git, GitError};

/// How a file differs on one side (index or working tree).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// Path relative to the repository root, with `/` separators.
    pub path: String,
    /// Previous path for renames and copies.
    pub orig_path: Option<String>,
    /// Change between HEAD and the index (staged), if any.
    pub staged: Option<ChangeKind>,
    /// Change between the index and the working tree (unstaged), if any.
    pub unstaged: Option<ChangeKind>,
    pub is_submodule: bool,
}

impl FileChange {
    pub fn is_conflicted(&self) -> bool {
        self.staged == Some(ChangeKind::Conflicted)
    }

    /// Whether HEAD has a version of this file (at `orig_path` for renames).
    pub fn exists_in_head(&self) -> bool {
        !matches!(
            self.staged,
            Some(ChangeKind::Added) | Some(ChangeKind::Copied)
        ) && self.unstaged != Some(ChangeKind::Untracked)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BranchStatus {
    /// Current branch name; `None` when HEAD is detached.
    pub head: Option<String>,
    /// HEAD commit; `None` on an unborn branch (no commits yet).
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub branch: BranchStatus,
    pub files: Vec<FileChange>,
    /// Tags made in the app that no push has sent yet; the next push
    /// carries them.
    pub unpushed_tags: Vec<String>,
}

pub fn status(git: &Git, repo: &Path) -> Result<RepoStatus, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "--untracked-files=all",
            "--ignore-submodules=none",
        ])
        .run()?;
    let mut status = parse(&output.stdout_str())?;
    status.unpushed_tags = crate::tag::unpushed(git, repo)?;
    Ok(status)
}

/// Parses NUL-separated porcelain v2 output.
pub fn parse(output: &str) -> Result<RepoStatus, GitError> {
    let mut status = RepoStatus::default();
    let mut records = output.split('\0').filter(|r| !r.is_empty());

    while let Some(record) = records.next() {
        let bad = || GitError::Parse(format!("status record: {record:?}"));
        let (tag, rest) = record.split_once(' ').ok_or_else(bad)?;
        match tag {
            "#" => parse_header(rest, &mut status.branch),
            // 1 XY sub mH mI mW hH hI path
            "1" => {
                let fields: Vec<&str> = rest.splitn(8, ' ').collect();
                let [xy, sub, _, _, _, _, _, path] = fields[..] else {
                    return Err(bad());
                };
                status
                    .files
                    .push(change(xy, sub, path, None).ok_or_else(bad)?);
            }
            // 2 XY sub mH mI mW hH hI Xscore path NUL origPath
            "2" => {
                let fields: Vec<&str> = rest.splitn(9, ' ').collect();
                let [xy, sub, _, _, _, _, _, _, path] = fields[..] else {
                    return Err(bad());
                };
                let orig = records.next().ok_or_else(bad)?;
                status
                    .files
                    .push(change(xy, sub, path, Some(orig)).ok_or_else(bad)?);
            }
            // u XY sub m1 m2 m3 mW h1 h2 h3 path
            "u" => {
                let fields: Vec<&str> = rest.splitn(10, ' ').collect();
                let [_, sub, .., path] = fields[..] else {
                    return Err(bad());
                };
                status.files.push(FileChange {
                    path: path.to_owned(),
                    orig_path: None,
                    staged: Some(ChangeKind::Conflicted),
                    unstaged: Some(ChangeKind::Conflicted),
                    is_submodule: sub.starts_with('S'),
                });
            }
            "?" => status.files.push(FileChange {
                path: rest.to_owned(),
                orig_path: None,
                staged: None,
                unstaged: Some(ChangeKind::Untracked),
                is_submodule: false,
            }),
            // Ignored files are not requested; skip anything unexpected.
            _ => {}
        }
    }
    // git lists untracked files after all the others, so a new file would
    // jump up the list once included. Path order keeps every file in place.
    status.files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(status)
}

fn parse_header(rest: &str, branch: &mut BranchStatus) {
    let (key, value) = rest.split_once(' ').unwrap_or((rest, ""));
    match key {
        "branch.oid" => branch.oid = (value != "(initial)").then(|| value.to_owned()),
        "branch.head" => branch.head = (value != "(detached)").then(|| value.to_owned()),
        "branch.upstream" => branch.upstream = Some(value.to_owned()),
        "branch.ab" => {
            for part in value.split(' ') {
                if let Some(n) = part.strip_prefix('+') {
                    branch.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    branch.behind = n.parse().unwrap_or(0);
                }
            }
        }
        _ => {}
    }
}

fn change(xy: &str, sub: &str, path: &str, orig: Option<&str>) -> Option<FileChange> {
    let mut chars = xy.chars();
    let (x, y) = (chars.next()?, chars.next()?);
    Some(FileChange {
        path: path.to_owned(),
        orig_path: orig.map(str::to_owned),
        staged: kind(x),
        unstaged: kind(y),
        is_submodule: sub.starts_with('S'),
    })
}

fn kind(code: char) -> Option<ChangeKind> {
    match code {
        'A' => Some(ChangeKind::Added),
        'M' => Some(ChangeKind::Modified),
        'D' => Some(ChangeKind::Deleted),
        'R' => Some(ChangeKind::Renamed),
        'C' => Some(ChangeKind::Copied),
        'T' => Some(ChangeKind::TypeChanged),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_headers() {
        let out = "# branch.oid 1234abcd\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -3\0";
        let status = parse(out).unwrap();
        assert_eq!(
            status.branch,
            BranchStatus {
                head: Some("main".into()),
                oid: Some("1234abcd".into()),
                upstream: Some("origin/main".into()),
                ahead: 2,
                behind: 3,
            }
        );
    }

    #[test]
    fn parses_unborn_and_detached() {
        let status = parse("# branch.oid (initial)\0# branch.head main\0").unwrap();
        assert_eq!(status.branch.oid, None);
        assert_eq!(status.branch.head.as_deref(), Some("main"));

        let status = parse("# branch.oid abc\0# branch.head (detached)\0").unwrap();
        assert_eq!(status.branch.head, None);
    }

    #[test]
    fn parses_entries() {
        let out = concat!(
            "1 .M N... 100644 100644 100644 aaa bbb src/main.rs\0",
            "1 A. N... 000000 100644 100644 000 ccc 새 파일.txt\0",
            "2 R. N... 100644 100644 100644 ddd ddd R100 new name.rs\0old name.rs\0",
            "u UU N... 100644 100644 100644 100644 e1 e2 e3 conflict.txt\0",
            "? untracked dir/file with spaces.md\0",
            "1 .M SC.. 160000 160000 160000 fff fff vendor/lib\0",
        );
        let files = parse(out).unwrap().files;
        let file = |path: &str| files.iter().find(|f| f.path == path).unwrap();
        assert_eq!(files.len(), 6);

        assert_eq!(file("src/main.rs").staged, None);
        assert_eq!(file("src/main.rs").unstaged, Some(ChangeKind::Modified));

        assert_eq!(file("새 파일.txt").staged, Some(ChangeKind::Added));
        assert!(!file("새 파일.txt").exists_in_head());

        let renamed = file("new name.rs");
        assert_eq!(renamed.orig_path.as_deref(), Some("old name.rs"));
        assert_eq!(renamed.staged, Some(ChangeKind::Renamed));
        assert!(renamed.exists_in_head());

        assert!(file("conflict.txt").is_conflicted());
        assert_eq!(
            file("untracked dir/file with spaces.md").unstaged,
            Some(ChangeKind::Untracked)
        );
        assert!(file("vendor/lib").is_submodule);
    }

    #[test]
    fn lists_files_in_path_order_whether_tracked_or_not() {
        // git puts untracked files last.
        let out = concat!(
            "1 .M N... 100644 100644 100644 aaa bbb b.txt ",
            "1 .M N... 100644 100644 100644 aaa bbb d.txt ",
            "? a.txt ",
            "? c.txt ",
        );
        let paths: Vec<_> = parse(out)
            .unwrap()
            .files
            .into_iter()
            .map(|f| f.path)
            .collect();
        assert_eq!(paths, ["a.txt", "b.txt", "c.txt", "d.txt"]);
    }

    #[test]
    fn rejects_truncated_records() {
        assert!(parse("1 .M N...\0").is_err());
        assert!(parse("2 R. N... 1 1 1 a a R100 new\0").is_err());
    }
}
