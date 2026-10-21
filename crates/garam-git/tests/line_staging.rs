use std::fs;

use garam_git::diff::{self, DiffLine, FileDiff, LineKind};
use garam_git::patch::{self, LineRef};
use garam_git::testing::TestRepo;
use garam_git::{FileChange, status};

fn file(repo: &TestRepo, path: &str) -> FileChange {
    status::status(repo.git_handle(), repo.path())
        .unwrap()
        .files
        .into_iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} has no changes"))
}

fn lines(repo: &TestRepo, path: &str) -> (bool, Vec<DiffLine>) {
    match diff::file_diff(repo.git_handle(), repo.path(), &file(repo, path)).unwrap() {
        FileDiff::Text { hunks, selectable } => (
            selectable,
            hunks
                .into_iter()
                .flat_map(|h| h.lines)
                .filter(|l| l.kind != LineKind::Context)
                .collect(),
        ),
        other => panic!("{other:?}"),
    }
}

/// Stages the changed lines whose text is in `texts`.
fn stage(repo: &TestRepo, path: &str, texts: &[&str]) {
    let (_, changed) = lines(repo, path);
    let selected: Vec<LineRef> = changed
        .iter()
        .filter(|l| texts.contains(&l.text.as_str()))
        .filter_map(LineRef::of)
        .collect();
    patch::stage_lines(repo.git_handle(), repo.path(), &file(repo, path), &selected).unwrap();
}

fn index_content(repo: &TestRepo, path: &str) -> Vec<u8> {
    repo.git(["show", &format!(":{path}")]).stdout
}

fn staged_texts(repo: &TestRepo, path: &str) -> Vec<String> {
    lines(repo, path)
        .1
        .into_iter()
        .filter(|l| l.staged)
        .map(|l| {
            format!(
                "{}{}",
                if l.kind == LineKind::Added { "+" } else { "-" },
                l.text
            )
        })
        .collect()
}

#[test]
fn stages_some_lines_and_reports_them_as_staged() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\ntwo\nthree\nfour\n");
    repo.commit_all("initial");
    repo.write("a.txt", "one\nTWO\nthree\nfour\nfive\n");

    let (selectable, _) = lines(&repo, "a.txt");
    assert!(selectable);

    stage(&repo, "a.txt", &["five"]);
    assert_eq!(
        index_content(&repo, "a.txt"),
        b"one\ntwo\nthree\nfour\nfive\n"
    );
    assert_eq!(staged_texts(&repo, "a.txt"), ["+five"]);
    // Working tree is untouched.
    assert_eq!(
        fs::read_to_string(repo.path().join("a.txt")).unwrap(),
        "one\nTWO\nthree\nfour\nfive\n"
    );

    // Selection is absolute: now only the replacement.
    stage(&repo, "a.txt", &["two", "TWO"]);
    assert_eq!(index_content(&repo, "a.txt"), b"one\nTWO\nthree\nfour\n");
    assert_eq!(staged_texts(&repo, "a.txt"), ["-two", "+TWO"]);
}

#[test]
fn selecting_everything_or_nothing_uses_whole_file_staging() {
    let repo = TestRepo::new();
    repo.write("a.txt", "1\n2\n");
    repo.commit_all("initial");
    repo.write("a.txt", "1\n2\n3\n");

    stage(&repo, "a.txt", &["3"]);
    let f = file(&repo, "a.txt");
    assert!(f.staged.is_some() && f.unstaged.is_none());

    stage(&repo, "a.txt", &[]);
    let f = file(&repo, "a.txt");
    assert!(f.staged.is_none() && f.unstaged.is_some());
}

#[test]
fn partially_stages_an_untracked_file() {
    let repo = TestRepo::new();
    repo.commit_all("initial");
    repo.write("새 파일.txt", "keep\nskip\nkeep too\n");

    stage(&repo, "새 파일.txt", &["keep", "keep too"]);
    assert_eq!(index_content(&repo, "새 파일.txt"), b"keep\nkeep too\n");
    assert_eq!(staged_texts(&repo, "새 파일.txt"), ["+keep", "+keep too"]);
}

#[test]
fn partially_stages_on_an_unborn_branch() {
    let repo = TestRepo::new();
    repo.write("first.txt", "a\nb\n");
    stage(&repo, "first.txt", &["b"]);
    assert_eq!(index_content(&repo, "first.txt"), b"b\n");
}

#[test]
fn partially_stages_a_deleted_file() {
    let repo = TestRepo::new();
    repo.write("gone.txt", "x\ny\nz\n");
    repo.commit_all("initial");
    fs::remove_file(repo.path().join("gone.txt")).unwrap();

    stage(&repo, "gone.txt", &["y"]);
    assert_eq!(index_content(&repo, "gone.txt"), b"x\nz\n");
}

#[test]
fn preserves_crlf_line_endings() {
    let repo = TestRepo::new();
    repo.write("win.txt", "one\r\ntwo\r\n");
    repo.commit_all("initial");
    repo.write("win.txt", "one\r\nTWO\r\nthree\r\n");

    stage(&repo, "win.txt", &["three\r"]);
    assert_eq!(index_content(&repo, "win.txt"), b"one\r\ntwo\r\nthree\r\n");
}

#[test]
fn handles_missing_final_newline() {
    let repo = TestRepo::new();
    repo.write("eof.txt", "a\nb");
    repo.commit_all("initial");
    repo.write("eof.txt", "a\nb\nc");

    // Only the last line changed shape; take "c" but not the newline fix.
    stage(&repo, "eof.txt", &["c"]);
    assert_eq!(index_content(&repo, "eof.txt"), b"a\nb\nc");
}

#[cfg(unix)]
#[test]
fn keeps_the_executable_bit() {
    use std::os::unix::fs::PermissionsExt;
    let repo = TestRepo::new();
    let script = repo.write("run.sh", "#!/bin/sh\necho 1\n");
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    repo.commit_all("initial");
    repo.write("run.sh", "#!/bin/sh\necho 1\necho 2\necho 3\n");

    stage(&repo, "run.sh", &["echo 2"]);
    let entry = repo.git(["ls-files", "--stage", "run.sh"]);
    assert!(
        entry.stdout_str().starts_with("100755"),
        "{}",
        entry.stdout_str()
    );
}

#[test]
fn renames_are_not_line_stageable() {
    let repo = TestRepo::new();
    repo.write("old.txt", "same content here\n");
    repo.commit_all("initial");
    repo.git(["mv", "old.txt", "new.txt"]);
    let (selectable, _) = lines(&repo, "new.txt");
    assert!(!selectable);
}
