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
    let path = filter.path.trim();
    // Children before parents, so the list can be drawn as a graph. Search
    // results stay newest first; a path filter skips parents anyway.
    if query.is_empty() && path.is_empty() {
        args.push("--topo-order".into());
    }
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
pub(crate) fn log_records(
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
    /// Stashed changes, newest first.
    pub stashes: Vec<StashEntry>,
}

/// One entry of `git stash list`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub oid: String,
    /// The commit the changes were stashed on.
    pub base: String,
    /// `stash@{0}`.
    pub name: String,
    /// git's description, e.g. `On main: message` or `WIP on main: …`.
    pub message: String,
    pub author_name: String,
    /// Seconds since the Unix epoch.
    pub created_at: u32,
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

    markers.stashes = stashes(git, repo)?;
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
        let revs = [
            "--topo-order".to_owned(),
            upstream.clone(),
            "^HEAD".to_owned(),
        ];
        markers.incoming = log_records(git, repo, &revs, &[], 0, MAX_INCOMING)?;
    } else if parsed.has_remote {
        markers.unpushed = rev_list(git, repo, &["HEAD", "--not", "--remotes"])?;
    }
    Ok(markers)
}

fn stashes(git: &Git, repo: &Path) -> Result<Vec<StashEntry>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "stash",
            "list",
            "-z",
            "--format=%H%x1f%P%x1f%gd%x1f%gs%x1f%an%x1f%ct",
        ])
        .run()?;
    Ok(output
        .stdout_str()
        .split('\0')
        .filter_map(parse_stash)
        .collect())
}

fn parse_stash(record: &str) -> Option<StashEntry> {
    let f: Vec<&str> = record.trim_start_matches('\n').splitn(6, '\x1f').collect();
    let [oid, parents, name, message, author, date] = f[..] else {
        return None;
    };
    Some(StashEntry {
        oid: oid.to_owned(),
        base: parents.split_whitespace().next()?.to_owned(),
        name: name.to_owned(),
        message: message.to_owned(),
        author_name: author.to_owned(),
        created_at: date.parse().unwrap_or(0),
    })
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

pub(crate) fn parse_summary(record: &str) -> Result<CommitSummary, GitError> {
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
pub(crate) fn check_oid(oid: &str) -> Result<(), GitError> {
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
pub(crate) fn parse_name_status(output: &str) -> Vec<CommitFile> {
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
    ignore_whitespace: bool,
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
    diff_between(git, repo, &base, oid, file, ignore_whitespace)
}

/// Diff of one file from tree-ish `from` to `to`.
pub(crate) fn diff_between(
    git: &Git,
    repo: &Path,
    from: &str,
    to: &str,
    file: &CommitFile,
    ignore_whitespace: bool,
) -> Result<FileDiff, GitError> {
    let mut paths = vec![file.path.as_str()];
    if let Some(orig) = &file.orig_path {
        paths.push(orig);
    }
    let mut command = git.command().cwd(repo).read_only().args([
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--find-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
    ]);
    if ignore_whitespace {
        command = command.arg("--ignore-all-space");
    }
    let output = command.args([from, to]).paths(paths).run()?;
    if output.stdout.len() > MAX_DIFF_BYTES {
        return Ok(FileDiff::TooLarge);
    }
    Ok(diff::parse(&output.stdout_str()))
}

/// Creates a new commit that undoes `oid`. Merge commits are reverted
/// relative to their first parent. Conflicts leave the revert in progress
/// and return [`crate::ErrorKind::RevertConflict`].
pub fn revert(git: &Git, repo: &Path, oid: &str) -> Result<(), GitError> {
    revert_many(git, repo, &[oid.to_owned()])
}

/// Reverts each of `oids` in the given order (newest first undoes them
/// cleanly), one new commit each. Merges are reverted against their first
/// parent. A conflict stops the sequence, which the conflict banner then
/// continues or aborts.
pub fn revert_many(git: &Git, repo: &Path, oids: &[String]) -> Result<(), GitError> {
    for oid in oids {
        check_oid(oid)?;
    }
    git.command()
        .cwd(repo)
        .args(["revert", "--no-edit", "--mainline", "1"])
        .args(oids)
        .run()?;
    Ok(())
}

/// Applies `oid`'s changes as a new commit on HEAD. Merge commits are
/// picked relative to their first parent. Conflicts leave the cherry-pick
/// in progress and return [`crate::ErrorKind::CherryPickConflict`]; a pick
/// that would change nothing returns [`crate::ErrorKind::CherryPickEmpty`]
/// and leaves nothing behind.
pub fn cherry_pick(git: &Git, repo: &Path, oid: &str) -> Result<(), GitError> {
    cherry_pick_many(git, repo, &[oid.to_owned()]).map(|_| ())
}

/// How a cherry-pick of several commits went.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CherryPickOutcome {
    pub picked: u32,
    /// Commits whose changes HEAD already had.
    pub skipped: u32,
}

/// Applies `oids` to HEAD in the given order (oldest first), one new
/// commit each. Commits that would change nothing are skipped; if all of
/// them would, that is [`crate::ErrorKind::CherryPickEmpty`]. A conflict
/// stops the sequence as [`crate::ErrorKind::CherryPickConflict`].
pub fn cherry_pick_many(
    git: &Git,
    repo: &Path,
    oids: &[String],
) -> Result<CherryPickOutcome, GitError> {
    for oid in oids {
        check_oid(oid)?;
    }
    let before = crate::commit::head_oid(git, repo)?;
    let mut skipped = 0;
    let mut result = git
        .command()
        .cwd(repo)
        .args(["cherry-pick", "--mainline", "1"])
        .args(oids)
        .run();
    while let Err(err) = result {
        let GitError::Failed { code, stderr, .. } = err else {
            return Err(err);
        };
        let state = crate::conflict::state(git, repo)?;
        if state.operation != Some(crate::conflict::Operation::CherryPick) {
            return Err(GitError::failed(code, stderr));
        }
        if !state.files.is_empty() {
            return Err(GitError::Failed {
                kind: crate::ErrorKind::CherryPickConflict,
                code,
                stderr,
            });
        }
        // git stops at a pick that would change nothing; skip it and go on.
        skipped += 1;
        result = git
            .command()
            .cwd(repo)
            .args(["cherry-pick", "--skip"])
            .run();
    }
    let range = match &before {
        Some(before) => format!("{before}..HEAD"),
        None => "HEAD".to_owned(),
    };
    let picked = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["rev-list", "--count", &range, "--"])
        .run()?
        .stdout_str()
        .trim()
        .parse()
        .unwrap_or(0);
    if picked == 0 {
        return Err(GitError::Failed {
            kind: crate::ErrorKind::CherryPickEmpty,
            code: None,
            stderr: String::new(),
        });
    }
    Ok(CherryPickOutcome { picked, skipped })
}

/// Switches to the local branch `branch` and cherry-picks `oids` (oldest
/// first) onto it, for taking commits from here to another branch. Stays
/// there afterwards, also when a conflict stops the picks. Needs a clean
/// working tree, so no uncommitted change travels along by surprise.
pub fn cherry_pick_onto(
    git: &Git,
    repo: &Path,
    branch: &str,
    oids: &[String],
) -> Result<CherryPickOutcome, GitError> {
    crate::branch::validate_name(git, branch)?;
    for oid in oids {
        check_oid(oid)?;
    }
    if has_tracked_changes(git, repo)? {
        return Err(GitError::UncommittedChanges);
    }
    git.command()
        .cwd(repo)
        .args(["switch", "--quiet", "--no-guess", branch])
        .run()?;
    cherry_pick_many(git, repo, oids)
}

/// How far back along HEAD's first parents squash looks for its commits.
const SQUASH_SEARCH: u32 = 5000;

/// Combines `oids` into one commit with `message`. They must be
/// consecutive commits on HEAD's first-parent line, with no merge commit
/// among them or after them, so the result is plain to replay. The new
/// commit keeps the oldest one's author. Commits after them are rebased
/// onto it, which needs a clean working tree. Returns the new commit id.
pub fn squash(git: &Git, repo: &Path, oids: &[String], message: &str) -> Result<String, GitError> {
    let message = message.trim();
    if oids.len() < 2 || message.is_empty() {
        return Err(GitError::CannotSquash);
    }
    for oid in oids {
        check_oid(oid)?;
    }
    if crate::commit::head_oid(git, repo)?.is_none() {
        return Err(GitError::CannotSquash);
    }
    let line = log_records(
        git,
        repo,
        &["--first-parent".into(), "HEAD".into()],
        &[],
        0,
        SQUASH_SEARCH,
    )?;
    let mut positions = oids
        .iter()
        .map(|oid| line.iter().position(|c| c.oid.starts_with(oid.as_str())))
        .collect::<Option<Vec<_>>>()
        .ok_or(GitError::CannotSquash)?;
    positions.sort_unstable();
    positions.dedup();
    let (newest, oldest) = (positions[0], positions[positions.len() - 1]);
    if oldest - newest + 1 != positions.len() || positions.len() != oids.len() {
        return Err(GitError::CannotSquash);
    }
    if line[..=oldest].iter().any(|c| c.parents.len() > 1) {
        return Err(GitError::CannotSquash);
    }
    if newest > 0 && has_tracked_changes(git, repo)? {
        return Err(GitError::UncommittedChanges);
    }

    let (newest, oldest) = (&line[newest], &line[oldest]);
    let author = git
        .command()
        .cwd(repo)
        .read_only()
        .args([
            "log",
            "-1",
            "--date=raw",
            "--format=%an%x1f%ae%x1f%ad",
            &oldest.oid,
            "--",
        ])
        .run()?;
    let author = author.stdout_str();
    let mut author = author.trim().splitn(3, '\x1f');
    let mut command = git
        .command()
        .cwd(repo)
        .env("GIT_AUTHOR_NAME", author.next().unwrap_or_default())
        .env("GIT_AUTHOR_EMAIL", author.next().unwrap_or_default())
        .env("GIT_AUTHOR_DATE", author.next().unwrap_or_default())
        .arg("commit-tree")
        .arg(format!("{}^{{tree}}", newest.oid));
    if let Some(parent) = oldest.parents.first() {
        command = command.args(["-p", parent]);
    }
    let squashed = command
        .args(["-F", "-"])
        .stdin(format!("{message}\n").into_bytes())
        .run()?;
    let squashed = squashed.stdout_str().trim().to_owned();

    if line[0].oid == newest.oid {
        // Same tree as HEAD, so the index and working tree stay as they are.
        reset(git, repo, &squashed, ResetMode::Soft)?;
    } else {
        git.command()
            .cwd(repo)
            .args(["rebase", "--onto", &squashed, &newest.oid])
            .run()?;
    }
    Ok(squashed)
}

fn has_tracked_changes(git: &Git, repo: &Path) -> Result<bool, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["status", "--porcelain=v1", "--untracked-files=no", "-z"])
        .run()?;
    Ok(!output.stdout.is_empty())
}

/// What `reset` keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum ResetMode {
    /// Keep the undone commits' changes staged.
    Soft,
    /// Keep them in the working tree, unstaged.
    Mixed,
    /// Discard them, and any uncommitted changes to tracked files.
    Hard,
}

/// Moves the current branch (or detached HEAD) to `oid`.
pub fn reset(git: &Git, repo: &Path, oid: &str, mode: ResetMode) -> Result<(), GitError> {
    check_oid(oid)?;
    let flag = match mode {
        ResetMode::Soft => "--soft",
        ResetMode::Mixed => "--mixed",
        ResetMode::Hard => "--hard",
    };
    git.command()
        .cwd(repo)
        .args(["reset", "--quiet", flag])
        .arg(format!("{oid}^{{commit}}"))
        .arg("--")
        .run()?;
    Ok(())
}

/// Undoes the last commit, which must still be `oid`, keeping its changes
/// staged. Returns its message so it can be edited and committed again.
/// Merge commits can't be undone this way.
pub fn undo_last_commit(
    git: &Git,
    repo: &Path,
    oid: &str,
) -> Result<crate::commit::HeadCommit, GitError> {
    let head = crate::commit::head_oid(git, repo)?;
    if head.as_deref() != Some(oid) {
        return Err(GitError::HeadMoved);
    }
    let detail = detail(git, repo, oid)?;
    match detail.commit.parents.as_slice() {
        [] => {
            // The first commit: leave the branch unborn, its files staged.
            git.command()
                .cwd(repo)
                .args(["update-ref", "-d", "HEAD", oid])
                .run()?;
        }
        [parent] => reset(git, repo, parent, ResetMode::Soft)?,
        _ => return Err(GitError::Parse("can't undo a merge commit".into())),
    }
    Ok(crate::commit::HeadCommit {
        oid: detail.commit.oid,
        summary: detail.commit.summary,
        body: detail.body,
    })
}

/// Checks out `oid` on a detached HEAD. Local changes come along when they
/// don't clash with it.
pub fn checkout(git: &Git, repo: &Path, oid: &str) -> Result<(), GitError> {
    check_oid(oid)?;
    git.command()
        .cwd(repo)
        .args(["switch", "--quiet", "--detach"])
        .arg(format!("{oid}^{{commit}}"))
        .run()?;
    Ok(())
}

/// The first parent of `oid`, or `None` for a root commit.
pub fn first_parent(git: &Git, repo: &Path, oid: &str) -> Result<Option<String>, GitError> {
    check_oid(oid)?;
    crate::commit::resolve_commit(git, repo, &format!("{oid}^"))
}

/// Whether a commit's signature checks out, from `git log --format=%G?`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum SignatureStatus {
    /// Not signed.
    None,
    Good,
    /// A good signature from a key that isn't trusted.
    GoodUntrusted,
    Bad,
    /// A good signature that has expired, or made with an expired key.
    Expired,
    Revoked,
    /// Signed, but the key isn't available to check it.
    CannotCheck,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Signature {
    pub status: SignatureStatus,
    /// Who signed it, when git could tell.
    pub signer: Option<String>,
    pub key: Option<String>,
}

/// Checks `oid`'s signature with the user's GPG or SSH setup. Separate
/// from [`detail`] because it may run gpg.
pub fn signature(git: &Git, repo: &Path, oid: &str) -> Result<Signature, GitError> {
    check_oid(oid)?;
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["log", "-1", "--format=%G?%x1f%GS%x1f%GK"])
        .arg(format!("{oid}^{{commit}}"))
        .arg("--")
        .run()?;
    Ok(parse_signature(output.stdout_str().trim_end()))
}

fn parse_signature(output: &str) -> Signature {
    let mut f = output.splitn(3, '\x1f');
    let status = match f.next().unwrap_or("") {
        "G" => SignatureStatus::Good,
        "U" => SignatureStatus::GoodUntrusted,
        "B" => SignatureStatus::Bad,
        "X" | "Y" => SignatureStatus::Expired,
        "R" => SignatureStatus::Revoked,
        "E" => SignatureStatus::CannotCheck,
        _ => SignatureStatus::None,
    };
    let field = |v: Option<&str>| {
        v.map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
    };
    Signature {
        status,
        signer: field(f.next()),
        key: field(f.next()),
    }
}

/// `oid` as an email-style patch that `git am` can apply. Merge commits
/// are shown against their first parent.
pub fn patch(git: &Git, repo: &Path, oid: &str) -> Result<String, GitError> {
    let summary = detail(git, repo, oid)?.commit;
    let mut command = git.command().cwd(repo).read_only();
    command = if summary.parents.len() > 1 {
        // format-patch skips merges.
        command.args([
            "log",
            "-1",
            "--format=email",
            "--patch",
            "--stat",
            "--diff-merges=first-parent",
        ])
    } else {
        command.args(["format-patch", "-1", "--stdout", "--no-signature"])
    };
    let output = command
        .args(["--no-color", "--no-ext-diff", &summary.oid])
        .arg("--")
        .run()?;
    Ok(output.stdout_str().into_owned())
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
    fn parses_stash_entries() {
        let entry =
            parse_stash("aaa\x1fbbb ccc\x1fstash@{0}\x1fOn main: 메모\x1f김가람\x1f1700000000")
                .unwrap();
        assert_eq!(entry.oid, "aaa");
        assert_eq!(entry.base, "bbb");
        assert_eq!(entry.name, "stash@{0}");
        assert_eq!(entry.message, "On main: 메모");
        assert_eq!(entry.created_at, 1_700_000_000);
        assert!(parse_stash("").is_none());
    }

    #[test]
    fn parses_signature_status() {
        let good = parse_signature("G\x1fKim <kim@example.com>\x1fABCD");
        assert_eq!(good.status, SignatureStatus::Good);
        assert_eq!(good.signer.as_deref(), Some("Kim <kim@example.com>"));
        assert_eq!(good.key.as_deref(), Some("ABCD"));
        let none = parse_signature("N\x1f\x1f");
        assert_eq!(none.status, SignatureStatus::None);
        assert_eq!(none.signer, None);
        assert_eq!(
            parse_signature("Y\x1f\x1f").status,
            SignatureStatus::Expired
        );
        assert_eq!(
            parse_signature("E\x1f\x1fK").status,
            SignatureStatus::CannotCheck
        );
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
