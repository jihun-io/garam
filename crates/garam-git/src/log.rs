//! History: paged commit list, ref and sync markers, commit details,
//! per-file diffs, revert.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::diff::{self, FileDiff};
use crate::status::ChangeKind;
use crate::{Git, GitError};

/// Raw diffs larger than this are not rendered.
const MAX_DIFF_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub oid: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    /// Seconds since the Unix epoch.
    pub authored_at: u32,
    pub summary: String,
}

/// Which commits the history walks.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HistoryScope {
    /// The checked-out branch (or detached HEAD).
    #[default]
    Head,
    /// Every local branch, remote branch and tag.
    All,
    /// One branch, by its full name (`refs/heads/x`, `refs/remotes/o/x`).
    Ref { refname: String },
}

/// What a history search looks at.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum SearchField {
    /// The commit message. A query that looks like a hash also finds that
    /// commit.
    #[default]
    Message,
    /// Author name or email.
    Author,
    /// Added or removed text in the changes (`git log -S`).
    Content,
}

/// Narrows the history. The default is HEAD's whole history.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HistoryFilter {
    pub scope: HistoryScope,
    /// Matched literally, ignoring case. Empty matches everything.
    pub query: String,
    pub search_in: SearchField,
    /// A path relative to the repository root: only commits touching it.
    /// Empty matches every path.
    pub path: String,
    /// Follow only the first parent of merges, as the branch saw them.
    pub first_parent: bool,
}

/// Up to `limit` commits matching `filter`, newest first, after skipping
/// `skip`. Empty on a branch without commits.
pub fn list(
    git: &Git,
    repo: &Path,
    filter: &HistoryFilter,
    skip: u32,
    limit: u32,
) -> Result<Vec<CommitSummary>, GitError> {
    let head = crate::commit::head_oid(git, repo)?;
    let mut args: Vec<String> = Vec::new();
    if filter.first_parent {
        args.push("--first-parent".into());
    }
    let query = filter.query.trim();
    if !query.is_empty() {
        match filter.search_in {
            SearchField::Message => args.push(format!("--grep={query}")),
            SearchField::Author => args.push(format!("--author={query}")),
            SearchField::Content => args.push(format!("-S{query}")),
        }
        args.extend(["--regexp-ignore-case".into(), "--fixed-strings".into()]);
    }
    match &filter.scope {
        HistoryScope::Head => {
            let Some(head) = &head else {
                return Ok(Vec::new());
            };
            args.push(head.clone());
        }
        HistoryScope::All => {
            args.extend(["--branches", "--remotes", "--tags"].map(String::from));
            // A detached HEAD is on no branch.
            args.extend(head.clone());
        }
        HistoryScope::Ref { refname } => {
            let oid = refname
                .starts_with("refs/")
                .then(|| crate::commit::resolve_commit(git, repo, refname))
                .transpose()?
                .flatten()
                .ok_or_else(|| GitError::Parse(format!("not a branch: {refname:?}")))?;
            args.push(oid);
        }
    }
    let path = filter.path.trim();
    let paths: Vec<&str> = if path.is_empty() { vec![] } else { vec![path] };
    let mut commits = log_records(git, repo, &args, &paths, skip, limit)?;

    // A hash typed into the search finds that commit, wherever it is.
    if skip == 0
        && filter.search_in == SearchField::Message
        && looks_like_hash(query)
        && let Some(oid) = crate::commit::resolve_commit(git, repo, query)?
    {
        commits.retain(|c| c.oid != oid);
        let found = log_records(git, repo, &["--no-walk".into(), oid], &[], 0, 1)?;
        commits.splice(0..0, found);
    }
    Ok(commits)
}

fn looks_like_hash(query: &str) -> bool {
    (7..=64).contains(&query.len()) && query.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `git log` of `revs` (options and commits) as commit summaries,
/// limited to `paths` when given.
fn log_records(
    git: &Git,
    repo: &Path,
    revs: &[String],
    paths: &[&str],
    skip: u32,
    limit: u32,
) -> Result<Vec<CommitSummary>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "log",
            "-z",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s",
            &format!("--skip={skip}"),
            &format!("--max-count={limit}"),
        ])
        .args(revs)
        .paths(paths)
        .run()?;
    output
        .stdout_str()
        .split('\0')
        .filter(|record| !record.is_empty())
        .map(parse_summary)
        .collect()
}

/// At most this many unpushed commits are marked.
const MAX_UNPUSHED: u32 = 1000;
/// At most this many incoming commits are listed.
const MAX_INCOMING: u32 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum RefKind {
    /// A detached HEAD.
    Head,
    Branch,
    Remote,
    Tag,
}

/// A name pointing at a commit, shown next to it in the history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RefLabel {
    /// The commit it points at (annotated tags are peeled).
    pub oid: String,
    pub kind: RefKind,
    /// Short name: `main`, `origin/main`, `v1.0`, or `HEAD`.
    pub name: String,
    /// The checked-out branch, or a detached HEAD.
    pub current: bool,
}

/// Where HEAD's history stands against its remote.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HistoryMarkers {
    pub refs: Vec<RefLabel>,
    /// Commits on HEAD not yet on the upstream (or, without one, on any
    /// remote branch). Empty when the repository has no remote branches.
    pub unpushed: Vec<String>,
    /// Commits on the upstream that HEAD doesn't have yet, newest first.
    pub incoming: Vec<CommitSummary>,
}

pub fn markers(git: &Git, repo: &Path) -> Result<HistoryMarkers, GitError> {
    const FORMAT: &str = "%(refname)%00%(refname:short)%00%(objectname)%00%(*objectname)%00\
                          %(HEAD)%00%(upstream)%00%(upstream:track,nobracket)%00%(symref)";
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["for-each-ref", &format!("--format={FORMAT}")])
        .args(["refs/heads", "refs/remotes", "refs/tags"])
        .run()?;
    let parsed = parse_refs(&output.stdout_str());
    let mut markers = HistoryMarkers {
        refs: parsed.refs,
        ..Default::default()
    };

    let Some(head) = crate::commit::head_oid(git, repo)? else {
        return Ok(markers);
    };
    if !parsed.on_branch {
        markers.refs.insert(
            0,
            RefLabel {
                oid: head,
                kind: RefKind::Head,
                name: "HEAD".to_owned(),
                current: true,
            },
        );
    }

    if let Some(upstream) = &parsed.upstream {
        let not_upstream = format!("^{upstream}");
        markers.unpushed = rev_list(git, repo, &["HEAD", &not_upstream])?;
        let revs = [upstream.clone(), "^HEAD".to_owned()];
        markers.incoming = log_records(git, repo, &revs, &[], 0, MAX_INCOMING)?;
    } else if parsed.has_remote {
        markers.unpushed = rev_list(git, repo, &["HEAD", "--not", "--remotes"])?;
    }
    Ok(markers)
}

fn rev_list(git: &Git, repo: &Path, revs: &[&str]) -> Result<Vec<String>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-list", &format!("--max-count={MAX_UNPUSHED}")])
        .args(revs)
        .arg("--")
        .run()?;
    Ok(output.stdout_str().lines().map(str::to_owned).collect())
}

#[derive(Debug, Default)]
struct ParsedRefs {
    refs: Vec<RefLabel>,
    /// The current branch's upstream ref, unless it is gone.
    upstream: Option<String>,
    /// HEAD is on a branch (not detached, not unborn-and-unlisted).
    on_branch: bool,
    has_remote: bool,
}

fn parse_refs(output: &str) -> ParsedRefs {
    let mut parsed = ParsedRefs::default();
    for line in output.lines() {
        let f: Vec<&str> = line.splitn(8, '\0').collect();
        let [full, short, oid, peeled, head, upstream, track, symref] = f[..] else {
            continue;
        };
        // Symbolic refs such as origin/HEAD repeat another ref.
        if !symref.is_empty() {
            continue;
        }
        let kind = if full.starts_with("refs/heads/") {
            RefKind::Branch
        } else if full.starts_with("refs/remotes/") {
            parsed.has_remote = true;
            RefKind::Remote
        } else {
            RefKind::Tag
        };
        let current = head == "*";
        if current {
            parsed.on_branch = true;
            if !upstream.is_empty() && track != "gone" {
                parsed.upstream = Some(upstream.to_owned());
            }
        }
        parsed.refs.push(RefLabel {
            oid: if peeled.is_empty() { oid } else { peeled }.to_owned(),
            kind,
            name: short.to_owned(),
            current,
        });
    }
    parsed
}

fn parse_summary(record: &str) -> Result<CommitSummary, GitError> {
    let f: Vec<&str> = record.trim_start_matches('\n').splitn(6, '\x1f').collect();
    let [oid, parents, name, email, date, summary] = f[..] else {
        return Err(GitError::Parse(format!("log record: {record:?}")));
    };
    Ok(CommitSummary {
        oid: oid.to_owned(),
        parents: parents.split_whitespace().map(str::to_owned).collect(),
        author_name: name.to_owned(),
        author_email: email.to_owned(),
        authored_at: date.parse().unwrap_or(0),
        summary: summary.to_owned(),
    })
}

/// A file changed by a commit, compared with its first parent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    /// Previous path for renames and copies.
    pub orig_path: Option<String>,
    pub kind: ChangeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    #[serde(flatten)]
    pub commit: CommitSummary,
    /// The message after the summary line, trimmed.
    pub body: String,
    pub committer_name: String,
    pub committed_at: u32,
    pub files: Vec<CommitFile>,
}

/// Accepts only hexadecimal object ids, so input can't pose as an option
/// or a revision expression.
fn check_oid(oid: &str) -> Result<(), GitError> {
    if !oid.is_empty() && oid.len() <= 64 && oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(GitError::Parse(format!("not a commit id: {oid:?}")))
    }
}

pub fn detail(git: &Git, repo: &Path, oid: &str) -> Result<CommitDetail, GitError> {
    check_oid(oid)?;
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "show",
            "--no-patch",
            "-z",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%cn%x1f%ct%x1f%b",
            &format!("{oid}^{{commit}}"),
            "--",
        ])
        .run()?;
    let text = output.stdout_str();
    let f: Vec<&str> = text.trim_end_matches('\0').splitn(9, '\x1f').collect();
    let [_, _, _, _, _, _, committer, committed, body] = f[..] else {
        return Err(GitError::Parse(format!("show output: {text:?}")));
    };
    let commit = parse_summary(&f[..6].join("\x1f"))?;
    let files = changed_files(git, repo, &commit)?;
    Ok(CommitDetail {
        body: body.trim().to_owned(),
        committer_name: committer.to_owned(),
        committed_at: committed.parse().unwrap_or(0),
        files,
        commit,
    })
}

/// The tree a commit is compared with: its first parent, or the empty
/// tree for a root commit.
fn base_of(git: &Git, repo: &Path, commit: &CommitSummary) -> Result<String, GitError> {
    match commit.parents.first() {
        Some(parent) => Ok(parent.clone()),
        None => diff::empty_tree(git, repo),
    }
}

fn changed_files(
    git: &Git,
    repo: &Path,
    commit: &CommitSummary,
) -> Result<Vec<CommitFile>, GitError> {
    let base = base_of(git, repo, commit)?;
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "diff-tree",
            "-r",
            "-z",
            "--no-commit-id",
            "--name-status",
            "--find-renames",
            &base,
            &commit.oid,
            "--",
        ])
        .run()?;
    Ok(parse_name_status(&output.stdout_str()))
}

/// Parses `-z --name-status`: `M\0path\0` or `R100\0old\0new\0`.
fn parse_name_status(output: &str) -> Vec<CommitFile> {
    let mut fields = output.split('\0').filter(|f| !f.is_empty());
    let mut files = Vec::new();
    while let Some(status) = fields.next() {
        let kind = match status.as_bytes().first() {
            Some(b'A') => ChangeKind::Added,
            Some(b'D') => ChangeKind::Deleted,
            Some(b'R') => ChangeKind::Renamed,
            Some(b'C') => ChangeKind::Copied,
            Some(b'T') => ChangeKind::TypeChanged,
            Some(b'U') => ChangeKind::Conflicted,
            _ => ChangeKind::Modified,
        };
        let Some(first) = fields.next() else { break };
        let (path, orig_path) = if matches!(kind, ChangeKind::Renamed | ChangeKind::Copied) {
            let Some(new) = fields.next() else { break };
            (new.to_owned(), Some(first.to_owned()))
        } else {
            (first.to_owned(), None)
        };
        files.push(CommitFile {
            path,
            orig_path,
            kind,
        });
    }
    files
}

/// Diff of one file in `oid` against the commit's first parent.
pub fn file_diff(
    git: &Git,
    repo: &Path,
    oid: &str,
    file: &CommitFile,
) -> Result<FileDiff, GitError> {
    check_oid(oid)?;
    let parents = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-parse", &format!("{oid}^@")])
        .run()?;
    let base = match parents.stdout_str().lines().next() {
        Some(parent) => parent.trim().to_owned(),
        None => diff::empty_tree(git, repo)?,
    };
    let mut paths = vec![file.path.as_str()];
    if let Some(orig) = &file.orig_path {
        paths.push(orig);
    }
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--find-renames",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            &base,
            oid,
        ])
        .paths(paths)
        .run()?;
    if output.stdout.len() > MAX_DIFF_BYTES {
        return Ok(FileDiff::TooLarge);
    }
    Ok(diff::parse(&output.stdout_str()))
}

/// Creates a new commit that undoes `oid`. Merge commits are reverted
/// relative to their first parent. Conflicts leave the revert in progress
/// and return [`crate::ErrorKind::RevertConflict`].
pub fn revert(git: &Git, repo: &Path, oid: &str) -> Result<(), GitError> {
    let summary = detail(git, repo, oid)?.commit;
    let mut command = git.command().cwd(repo).args(["revert", "--no-edit"]);
    if summary.parents.len() > 1 {
        command = command.args(["--mainline", "1"]);
    }
    command.arg(&summary.oid).run()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_records() {
        let record = "aaa\x1fbbb ccc\x1f김가람\x1fgaram@example.com\x1f1700000000\x1fMerge: x";
        let commit = parse_summary(record).unwrap();
        assert_eq!(commit.oid, "aaa");
        assert_eq!(commit.parents, ["bbb", "ccc"]);
        assert_eq!(commit.author_name, "김가람");
        assert_eq!(commit.authored_at, 1_700_000_000);
        assert_eq!(commit.summary, "Merge: x");

        let root = parse_summary("aaa\x1f\x1fA\x1fa@b\x1f1\x1fInit").unwrap();
        assert!(root.parents.is_empty());
        assert!(parse_summary("garbage").is_err());
    }

    #[test]
    fn parses_refs() {
        let out = "refs/heads/main\0main\0aaa\0\0*\0refs/remotes/origin/main\0ahead 1\0\n\
                   refs/heads/old\0old\0bbb\0\0 \0refs/remotes/origin/old\0gone\0\n\
                   refs/remotes/origin/HEAD\0origin\0aaa\0\0 \0\0\0refs/remotes/origin/main\n\
                   refs/remotes/origin/main\0origin/main\0ccc\0\0 \0\0\0\n\
                   refs/tags/v1\0v1\0ddd\0eee\0 \0\0\0\n";
        let parsed = parse_refs(out);
        assert!(parsed.on_branch);
        assert!(parsed.has_remote);
        assert_eq!(parsed.upstream.as_deref(), Some("refs/remotes/origin/main"));
        let names: Vec<_> = parsed.refs.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["main", "old", "origin/main", "v1"]);
        assert!(parsed.refs[0].current);
        assert_eq!(parsed.refs[2].kind, RefKind::Remote);
        assert_eq!(parsed.refs[3].kind, RefKind::Tag);
        assert_eq!(parsed.refs[3].oid, "eee", "annotated tags are peeled");
    }

    #[test]
    fn accepts_only_hex_ids() {
        assert!(check_oid("0123abcDEF").is_ok());
        for bad in ["", "--output=x", "HEAD", "abc^", "a b"] {
            assert!(check_oid(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn parses_name_status() {
        let out = "M\0src/main.rs\0R087\0old name.txt\0새 이름.txt\0A\0new.txt\0D\0gone.txt\0";
        let files = parse_name_status(out);
        assert_eq!(files.len(), 4);
        assert_eq!(files[0].kind, ChangeKind::Modified);
        assert_eq!(files[1].kind, ChangeKind::Renamed);
        assert_eq!(files[1].path, "새 이름.txt");
        assert_eq!(files[1].orig_path.as_deref(), Some("old name.txt"));
        assert_eq!(files[2].kind, ChangeKind::Added);
        assert_eq!(files[3].kind, ChangeKind::Deleted);
    }
}
