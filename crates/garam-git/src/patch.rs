//! Line-level staging.
//!
//! Instead of building a patch and running `git apply --cached`, this
//! reconstructs the exact file content the index should hold (HEAD plus the
//! selected changes from the HEAD → working tree diff), writes it as a blob
//! and points the index entry at it. That sidesteps hunk-header arithmetic
//! and the edge cases of partial patches (new files, missing final newline,
//! CRLF).

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::diff::{self, DiffLine, FileDiff, Hunk, LineKind};
use crate::status::ChangeKind;
use crate::{FileChange, Git, GitError, blob, index};

/// Identifies a changed line of the HEAD → working tree diff: an added line
/// by its new line number, a deleted line by its old line number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LineRef {
    pub kind: LineKind,
    pub line: u32,
}

impl LineRef {
    pub fn of(line: &DiffLine) -> Option<Self> {
        match line.kind {
            LineKind::Added => line.new_line.map(|n| Self {
                kind: LineKind::Added,
                line: n,
            }),
            LineKind::Deleted => line.old_line.map(|n| Self {
                kind: LineKind::Deleted,
                line: n,
            }),
            LineKind::Context => None,
        }
    }
}

/// Files whose diff maps one-to-one onto a single index entry. Renames,
/// conflicts, submodules and type changes are staged as whole files.
pub fn supports_line_staging(file: &FileChange) -> bool {
    file.orig_path.is_none()
        && !file.is_submodule
        && !matches!(
            file.staged,
            Some(
                ChangeKind::Renamed
                    | ChangeKind::Copied
                    | ChangeKind::TypeChanged
                    | ChangeKind::Conflicted
            )
        )
        && file.unstaged != Some(ChangeKind::TypeChanged)
}

/// Sets `staged` on every added/deleted line of the HEAD → working tree diff.
///
/// A deleted HEAD line is staged if the HEAD → index diff deletes it. An
/// added working-tree line is staged if it already exists in the index,
/// i.e. the index → working tree diff does not add it.
pub(crate) fn mark_staged_lines(
    git: &Git,
    repo: &Path,
    file: &FileChange,
    hunks: &mut [Hunk],
) -> Result<(), GitError> {
    let changed = hunks
        .iter_mut()
        .flat_map(|h| h.lines.iter_mut())
        .filter(|l| l.kind != LineKind::Context);

    match (file.staged, file.unstaged) {
        (None, _) => changed.for_each(|l| l.staged = false),
        (Some(_), None) => changed.for_each(|l| l.staged = true),
        _ if !supports_line_staging(file) => {}
        _ => {
            let staged_deletions: HashSet<u32> =
                changed_lines(git, repo, &file.path, true, LineKind::Deleted)?;
            let unstaged_additions: HashSet<u32> =
                changed_lines(git, repo, &file.path, false, LineKind::Added)?;
            for line in changed {
                line.staged = match line.kind {
                    LineKind::Deleted => {
                        line.old_line.is_some_and(|n| staged_deletions.contains(&n))
                    }
                    LineKind::Added => line
                        .new_line
                        .is_some_and(|n| !unstaged_additions.contains(&n)),
                    LineKind::Context => false,
                };
            }
        }
    }
    Ok(())
}

/// Line numbers of `kind` lines in `git diff [--cached] -U0 -- path`.
fn changed_lines(
    git: &Git,
    repo: &Path,
    path: &str,
    cached: bool,
    kind: LineKind,
) -> Result<HashSet<u32>, GitError> {
    let mut command = git.command().cwd(repo).read_only().args([
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--unified=0",
        "--src-prefix=a/",
        "--dst-prefix=b/",
    ]);
    if cached {
        command = command.arg("--cached");
    }
    let output = command.paths([path]).run()?;
    let FileDiff::Text { hunks, .. } = diff::parse(&output.stdout_str()) else {
        return Ok(HashSet::new());
    };
    Ok(hunks
        .iter()
        .flat_map(|h| &h.lines)
        .filter(|l| l.kind == kind)
        .filter_map(|l| match kind {
            LineKind::Deleted => l.old_line,
            _ => l.new_line,
        })
        .collect())
}

/// Makes the index hold exactly the `selected` changes of `file`; every
/// other change stays unstaged. `selected` uses line numbers from the
/// current HEAD → working tree diff.
pub fn stage_lines(
    git: &Git,
    repo: &Path,
    file: &FileChange,
    selected: &[LineRef],
) -> Result<(), GitError> {
    if !supports_line_staging(file) {
        return Err(GitError::Parse(format!(
            "line staging is not supported for {}",
            file.path
        )));
    }
    let FileDiff::Text {
        hunks,
        selectable: true,
    } = diff::file_diff(git, repo, file)?
    else {
        return Err(GitError::Parse(format!(
            "no line-stageable diff for {}",
            file.path
        )));
    };

    let selected: HashSet<LineRef> = selected.iter().copied().collect();
    let all: Vec<LineRef> = hunks
        .iter()
        .flat_map(|h| &h.lines)
        .filter_map(LineRef::of)
        .collect();
    let chosen = all.iter().filter(|r| selected.contains(r)).count();

    // Whole-file cases go through the regular commands, which also handle
    // deletions and modes exactly.
    if chosen == 0 {
        return index::unstage(git, repo, std::slice::from_ref(file));
    }
    if chosen == all.len() {
        return index::stage(git, repo, std::slice::from_ref(file));
    }

    let head = if file.exists_in_head() {
        blob::head_blob(git, repo, &file.path)?.unwrap_or_default()
    } else {
        Vec::new()
    };
    let content = build_content(&head, &hunks, |line| {
        LineRef::of(line).is_some_and(|r| selected.contains(&r))
    })?;
    let mode = file_mode(git, repo, &file.path)?;

    let hashed = git
        .command()
        .cwd(repo)
        .args(["hash-object", "-w", "--stdin", "--no-filters"])
        .stdin(content)
        .run()?;
    let oid = hashed.stdout_str().trim().to_owned();
    git.command()
        .cwd(repo)
        .args(["update-index", "--add", "--cacheinfo"])
        .arg(format!("{mode},{oid},{}", file.path))
        .run()?;
    Ok(())
}

/// Applies the changes for which `staged` returns true to `head`.
///
/// Context and unapplied deletions are copied byte-for-byte from `head`, so
/// line endings and a missing final newline survive untouched.
pub fn build_content(
    head: &[u8],
    hunks: &[Hunk],
    staged: impl Fn(&DiffLine) -> bool,
) -> Result<Vec<u8>, GitError> {
    let head_lines: Vec<&[u8]> = head.split_inclusive(|b| *b == b'\n').collect();
    let out_of_sync = || GitError::Parse("diff does not match HEAD content".into());
    let mut out = Vec::with_capacity(head.len());
    let mut cursor = 0usize;

    // A line without a trailing newline that gets something appended after
    // it needs one now.
    let push = |out: &mut Vec<u8>, bytes: &[u8]| {
        if !out.is_empty() && !out.ends_with(b"\n") {
            out.push(b'\n');
        }
        out.extend_from_slice(bytes);
    };

    for hunk in hunks {
        // For a pure insertion git reports the line *after which* it goes.
        let start = if hunk.old_lines == 0 {
            hunk.old_start as usize
        } else {
            (hunk.old_start as usize).saturating_sub(1)
        };
        if start < cursor || start > head_lines.len() {
            return Err(out_of_sync());
        }
        for line in &head_lines[cursor..start] {
            push(&mut out, line);
        }
        cursor = start;

        for line in &hunk.lines {
            match line.kind {
                LineKind::Context | LineKind::Deleted => {
                    let original = head_lines.get(cursor).ok_or_else(out_of_sync)?;
                    cursor += 1;
                    if line.kind == LineKind::Context || !staged(line) {
                        push(&mut out, original);
                    }
                }
                LineKind::Added => {
                    if staged(line) {
                        let mut bytes = line.text.as_bytes().to_vec();
                        if !line.no_newline {
                            bytes.push(b'\n');
                        }
                        push(&mut out, &bytes);
                    }
                }
            }
        }
    }
    for line in &head_lines[cursor..] {
        push(&mut out, line);
    }
    Ok(out)
}

/// Mode for the index entry: the existing index entry's, else HEAD's, else
/// derived from the working tree file.
fn file_mode(git: &Git, repo: &Path, path: &str) -> Result<String, GitError> {
    let from_listing = |args: &[&str]| -> Result<Option<String>, GitError> {
        let output = git
            .command()
            .cwd(repo)
            .read_only()
            .args(args)
            .paths([path])
            .run()?;
        Ok(output
            .stdout_str()
            .split_whitespace()
            .next()
            .map(str::to_owned))
    };
    if let Some(mode) = from_listing(&["ls-files", "--stage"])? {
        return Ok(mode);
    }
    if crate::commit::head_oid(git, repo)?.is_some()
        && let Some(mode) = from_listing(&["ls-tree", "HEAD"])?
    {
        return Ok(mode);
    }
    Ok(worktree_mode(&repo.join(path)))
}

#[cfg(unix)]
fn worktree_mode(path: &Path) -> String {
    use std::os::unix::fs::PermissionsExt;
    let executable = std::fs::metadata(path)
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false);
    if executable { "100755" } else { "100644" }.into()
}

#[cfg(not(unix))]
fn worktree_mode(_path: &Path) -> String {
    "100644".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hunks_of(diff: &str) -> Vec<Hunk> {
        match diff::parse(diff) {
            FileDiff::Text { hunks, .. } => hunks,
            other => panic!("{other:?}"),
        }
    }

    fn texts<'a>(selected: &'a [&'a str]) -> impl Fn(&DiffLine) -> bool + 'a {
        move |l| selected.contains(&l.text.as_str())
    }

    #[test]
    fn applies_only_selected_changes() {
        let head = b"a\nb\nc\n";
        let hunks = hunks_of("@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -3,0 +4,1 @@\n+d\n");
        // Take the insertion but keep the old "b".
        let out = build_content(head, &hunks, texts(&["d"])).unwrap();
        assert_eq!(out, b"a\nb\nc\nd\n");
        // Take the replacement only.
        let out = build_content(head, &hunks, texts(&["b", "B"])).unwrap();
        assert_eq!(out, b"a\nB\nc\n");
    }

    #[test]
    fn keeps_crlf_and_missing_final_newline() {
        let head = b"one\r\ntwo";
        let hunks = hunks_of(
            "@@ -1,2 +1,3 @@\n one\r\n-two\n\\ No newline at end of file\n+two\r\n+three\r\n",
        );
        // Only append "three": the old last line gains the newline it needs.
        let out = build_content(head, &hunks, texts(&["three\r"])).unwrap();
        assert_eq!(out, b"one\r\ntwo\nthree\r\n");
    }

    #[test]
    fn builds_new_file_from_nothing() {
        let hunks = hunks_of("@@ -0,0 +1,3 @@\n+x\n+y\n+z\n");
        let out = build_content(b"", &hunks, texts(&["x", "z"])).unwrap();
        assert_eq!(out, b"x\nz\n");
    }

    #[test]
    fn detects_a_stale_diff() {
        let hunks = hunks_of("@@ -5,1 +5,1 @@\n-gone\n+new\n");
        assert!(build_content(b"short\n", &hunks, |_| true).is_err());
    }
}
