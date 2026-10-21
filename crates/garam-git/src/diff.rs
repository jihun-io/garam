//! Unified diff of one file: HEAD → working tree, parsed into hunks.

use std::path::Path;

use serde::Serialize;

use crate::{FileChange, Git, GitError, status::ChangeKind};

/// Diffs larger than this (raw bytes) are not rendered.
const MAX_DIFF_BYTES: usize = 4 * 1024 * 1024;
/// Untracked files larger than this are not diffed at all.
const MAX_UNTRACKED_BYTES: u64 = 8 * 1024 * 1024;
const MAX_LINES: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum LineKind {
    Context,
    Added,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    pub text: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
    /// Followed by `\ No newline at end of file`.
    pub no_newline: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// Text after the closing `@@`, usually the enclosing function.
    pub section: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FileDiff {
    /// Text changes. `hunks` may be empty for mode-only changes or empty files.
    Text {
        hunks: Vec<Hunk>,
    },
    Binary,
    TooLarge,
}

/// Diff of `file` between HEAD (or nothing, for new files) and the working
/// tree, so staged and unstaged changes appear together.
pub fn file_diff(git: &Git, repo: &Path, file: &FileChange) -> Result<FileDiff, GitError> {
    let common = [
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
    ];

    let output = if file.unstaged == Some(ChangeKind::Untracked) {
        let size = std::fs::metadata(repo.join(&file.path))
            .map(|m| m.len())
            .unwrap_or(0);
        if size > MAX_UNTRACKED_BYTES {
            return Ok(FileDiff::TooLarge);
        }
        // Exit code 1 just means "there are differences".
        let output = git
            .command()
            .cwd(repo)
            .read_only()
            .args(common)
            .args(["--no-index", "--", "/dev/null"])
            .arg(&file.path)
            .run_unchecked()?;
        if output.code != Some(0) && output.code != Some(1) {
            return Err(GitError::failed(output.code, output.failure_text()));
        }
        output
    } else {
        let base = head_or_empty_tree(git, repo)?;
        let mut paths = vec![file.path.as_str()];
        if let Some(orig) = &file.orig_path {
            paths.push(orig);
        }
        git.command()
            .cwd(repo)
            .read_only()
            .args(common)
            .args(["--find-renames", &base])
            .paths(paths)
            .run()?
    };

    if output.stdout.len() > MAX_DIFF_BYTES {
        return Ok(FileDiff::TooLarge);
    }
    Ok(parse(&output.stdout_str()))
}

/// HEAD's commit id, or the empty tree on a branch with no commits yet.
pub(crate) fn head_or_empty_tree(git: &Git, repo: &Path) -> Result<String, GitError> {
    if let Some(head) = crate::commit::head_oid(git, repo)? {
        return Ok(head);
    }
    // Hashing an empty tree gives the right id for SHA-1 and SHA-256 repos.
    let output = git
        .command()
        .cwd(repo)
        .args(["hash-object", "-t", "tree", "--stdin"])
        .stdin(Vec::new())
        .run()?;
    Ok(output.stdout_str().trim().to_owned())
}

/// Parses `git diff` output for a single file.
pub fn parse(output: &str) -> FileDiff {
    let mut hunks: Vec<Hunk> = Vec::new();
    let mut total_lines = 0usize;
    let (mut old_no, mut new_no) = (0u32, 0u32);

    for line in output.lines() {
        if line.starts_with("Binary files ") || line == "GIT binary patch" {
            return FileDiff::Binary;
        }
        if let Some(header) = line.strip_prefix("@@ ") {
            if let Some(hunk) = parse_hunk_header(header) {
                old_no = hunk.old_start;
                new_no = hunk.new_start;
                hunks.push(hunk);
            }
            continue;
        }
        let Some(hunk) = hunks.last_mut() else {
            // File header lines (diff --git, index, ---, +++) come first.
            continue;
        };
        let (kind, text) = match line.as_bytes().first() {
            Some(b' ') => (LineKind::Context, &line[1..]),
            Some(b'+') => (LineKind::Added, &line[1..]),
            Some(b'-') => (LineKind::Deleted, &line[1..]),
            Some(b'\\') => {
                if let Some(last) = hunk.lines.last_mut() {
                    last.no_newline = true;
                }
                continue;
            }
            // An empty context line can lose its leading space.
            None => (LineKind::Context, ""),
            _ => continue,
        };
        let (old_line, new_line) = match kind {
            LineKind::Context => {
                old_no += 1;
                new_no += 1;
                (Some(old_no - 1), Some(new_no - 1))
            }
            LineKind::Added => {
                new_no += 1;
                (None, Some(new_no - 1))
            }
            LineKind::Deleted => {
                old_no += 1;
                (Some(old_no - 1), None)
            }
        };
        hunk.lines.push(DiffLine {
            kind,
            text: text.to_owned(),
            old_line,
            new_line,
            no_newline: false,
        });
        total_lines += 1;
        if total_lines > MAX_LINES {
            return FileDiff::TooLarge;
        }
    }
    FileDiff::Text { hunks }
}

/// Parses `-a,b +c,d @@ section` (the part after the leading `@@ `).
fn parse_hunk_header(header: &str) -> Option<Hunk> {
    let (ranges, section) = header.split_once(" @@").unwrap_or((header, ""));
    let mut parts = ranges.split(' ');
    let (old_start, old_lines) = parse_range(parts.next()?.strip_prefix('-')?)?;
    let (new_start, new_lines) = parse_range(parts.next()?.strip_prefix('+')?)?;
    Some(Hunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        section: section.trim().to_owned(),
        lines: Vec::new(),
    })
}

fn parse_range(range: &str) -> Option<(u32, u32)> {
    match range.split_once(',') {
        Some((start, len)) => Some((start.parse().ok()?, len.parse().ok()?)),
        None => Some((range.parse().ok()?, 1)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
diff --git a/src/lib.rs b/src/lib.rs
index 1111111..2222222 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,4 +1,5 @@ fn main() {
 use std::io;
-let a = 1;
+let a = 2;
+let b = 3;

 end
@@ -10 +11 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
";

    fn hunks(diff: FileDiff) -> Vec<Hunk> {
        match diff {
            FileDiff::Text { hunks } => hunks,
            other => panic!("expected text, got {other:?}"),
        }
    }

    #[test]
    fn parses_hunks_and_line_numbers() {
        let hunks = hunks(parse(SAMPLE));
        assert_eq!(hunks.len(), 2);

        let first = &hunks[0];
        assert_eq!(
            (
                first.old_start,
                first.old_lines,
                first.new_start,
                first.new_lines
            ),
            (1, 4, 1, 5)
        );
        assert_eq!(first.section, "fn main() {");
        let kinds: Vec<_> = first.lines.iter().map(|l| l.kind).collect();
        assert_eq!(
            kinds,
            [
                LineKind::Context,
                LineKind::Deleted,
                LineKind::Added,
                LineKind::Added,
                LineKind::Context,
                LineKind::Context,
            ]
        );
        assert_eq!(first.lines[1].old_line, Some(2));
        assert_eq!(first.lines[1].new_line, None);
        assert_eq!(first.lines[3].new_line, Some(3));
        assert_eq!(first.lines[3].text, "let b = 3;");
        // The blank context line kept its numbering.
        assert_eq!(first.lines[4].old_line, Some(3));
        assert_eq!(first.lines[4].new_line, Some(4));
    }

    #[test]
    fn marks_missing_final_newline() {
        let second = &hunks(parse(SAMPLE))[1];
        assert_eq!((second.old_start, second.old_lines), (10, 1));
        assert!(second.lines.iter().all(|l| l.no_newline));
    }

    #[test]
    fn detects_binary() {
        let out = "diff --git a/a.png b/a.png\nindex 1..2 100644\nBinary files a/a.png and b/a.png differ\n";
        assert_eq!(parse(out), FileDiff::Binary);
    }

    #[test]
    fn mode_only_change_has_no_hunks() {
        let out = "diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n";
        assert_eq!(parse(out), FileDiff::Text { hunks: vec![] });
    }
}
