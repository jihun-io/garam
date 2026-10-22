use std::fs;
use std::path::Path;

use garam_git::commit::{self, CoAuthor};
use garam_git::diff::{self, FileDiff, LineKind};
use garam_git::testing::TestRepo;
use garam_git::{ChangeKind, ErrorKind, FileChange, blob, identity, index, status};

fn files(repo: &TestRepo) -> Vec<FileChange> {
    status::status(repo.git_handle(), repo.path())
        .unwrap()
        .files
}

fn find<'a>(files: &'a [FileChange], path: &str) -> &'a FileChange {
    files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not in {files:?}"))
}

fn delete_file(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

#[test]
fn status_reports_every_kind_of_change() {
    let repo = TestRepo::new();
    repo.write("keep.txt", "a\n");
    repo.write("edit.txt", "a\n");
    repo.write("gone.txt", "a\n");
    repo.write("old.txt", "same content for rename detection\n");
    repo.commit_all("initial");

    repo.write("edit.txt", "b\n");
    fs::remove_file(repo.path().join("gone.txt")).unwrap();
    repo.git(["mv", "old.txt", "new.txt"]);
    repo.write("한글/새 파일.txt", "new\n");

    let status = status::status(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(status.branch.head.as_deref(), Some("main"));
    assert!(status.branch.oid.is_some());

    let files = status.files;
    assert_eq!(files.len(), 4, "{files:?}");
    assert_eq!(
        find(&files, "edit.txt").unstaged,
        Some(ChangeKind::Modified)
    );
    assert_eq!(find(&files, "gone.txt").unstaged, Some(ChangeKind::Deleted));
    let renamed = find(&files, "new.txt");
    assert_eq!(renamed.staged, Some(ChangeKind::Renamed));
    assert_eq!(renamed.orig_path.as_deref(), Some("old.txt"));
    assert_eq!(
        find(&files, "한글/새 파일.txt").unstaged,
        Some(ChangeKind::Untracked)
    );
}

#[test]
fn stage_and_unstage_round_trip() {
    let repo = TestRepo::new();
    repo.write("a.txt", "1\n");
    repo.commit_all("initial");
    repo.write("a.txt", "2\n");
    repo.write("b.txt", "new\n");

    let changes = files(&repo);
    index::stage(repo.git_handle(), repo.path(), &changes).unwrap();
    let staged = files(&repo);
    assert_eq!(find(&staged, "a.txt").staged, Some(ChangeKind::Modified));
    assert_eq!(find(&staged, "a.txt").unstaged, None);
    assert_eq!(find(&staged, "b.txt").staged, Some(ChangeKind::Added));

    index::unstage(repo.git_handle(), repo.path(), &staged).unwrap();
    let unstaged = files(&repo);
    assert_eq!(find(&unstaged, "a.txt").staged, None);
    assert_eq!(
        find(&unstaged, "a.txt").unstaged,
        Some(ChangeKind::Modified)
    );
    assert_eq!(
        find(&unstaged, "b.txt").unstaged,
        Some(ChangeKind::Untracked)
    );
}

#[test]
fn unstage_works_before_the_first_commit() {
    let repo = TestRepo::new();
    repo.write("first.txt", "hello\n");
    index::stage(repo.git_handle(), repo.path(), &files(&repo)).unwrap();
    assert_eq!(files(&repo)[0].staged, Some(ChangeKind::Added));

    index::unstage(repo.git_handle(), repo.path(), &files(&repo)).unwrap();
    assert_eq!(files(&repo)[0].unstaged, Some(ChangeKind::Untracked));
    assert!(repo.path().join("first.txt").exists());
}

#[test]
fn staging_a_rename_stages_both_sides() {
    let repo = TestRepo::new();
    repo.write("old.txt", "content that stays the same\n");
    repo.commit_all("initial");
    fs::rename(repo.path().join("old.txt"), repo.path().join("new.txt")).unwrap();

    // Before staging, git sees a deletion and an untracked file.
    let changes = files(&repo);
    index::stage(repo.git_handle(), repo.path(), &changes).unwrap();
    let staged = files(&repo);
    assert_eq!(staged.len(), 1, "{staged:?}");
    assert_eq!(staged[0].staged, Some(ChangeKind::Renamed));
}

#[test]
fn discard_restores_head_and_hands_files_to_remover() {
    let repo = TestRepo::new();
    repo.write("edit.txt", "original\n");
    repo.write("gone.txt", "original\n");
    repo.write("staged.txt", "original\n");
    repo.commit_all("initial");

    repo.write("edit.txt", "changed\n");
    fs::remove_file(repo.path().join("gone.txt")).unwrap();
    repo.write("staged.txt", "staged change\n");
    repo.git(["add", "staged.txt"]);
    repo.write("untracked.txt", "new\n");
    repo.write("added.txt", "added\n");
    repo.git(["add", "added.txt"]);

    let mut removed = Vec::new();
    index::discard(repo.git_handle(), repo.path(), &files(&repo), |p| {
        removed.push(p.file_name().unwrap().to_string_lossy().into_owned());
        delete_file(p)
    })
    .unwrap();

    assert!(files(&repo).is_empty(), "{:?}", files(&repo));
    let read = |p: &str| fs::read_to_string(repo.path().join(p)).unwrap();
    assert_eq!(read("edit.txt"), "original\n");
    assert_eq!(read("gone.txt"), "original\n");
    assert_eq!(read("staged.txt"), "original\n");
    assert!(!repo.path().join("untracked.txt").exists());
    assert!(!repo.path().join("added.txt").exists());

    removed.sort();
    // gone.txt didn't exist, so there was nothing to keep.
    assert_eq!(
        removed,
        ["added.txt", "edit.txt", "staged.txt", "untracked.txt"]
    );
}

#[test]
fn discard_undoes_a_staged_rename() {
    let repo = TestRepo::new();
    repo.write("old.txt", "content that stays the same\n");
    repo.commit_all("initial");
    repo.git(["mv", "old.txt", "new.txt"]);

    index::discard(repo.git_handle(), repo.path(), &files(&repo), delete_file).unwrap();
    assert!(files(&repo).is_empty());
    assert!(repo.path().join("old.txt").exists());
    assert!(!repo.path().join("new.txt").exists());
}

// Windows doesn't allow `*` in file names.
#[cfg(not(windows))]
#[test]
fn a_file_named_star_touches_only_itself() {
    let repo = TestRepo::new();
    repo.write("*", "original\n");
    repo.write("other.txt", "original\n");
    repo.commit_all("initial");
    repo.write("*", "changed\n");
    repo.write("other.txt", "precious\n");

    let star = find(&files(&repo), "*").clone();
    index::stage(repo.git_handle(), repo.path(), std::slice::from_ref(&star)).unwrap();
    assert_eq!(find(&files(&repo), "other.txt").staged, None);

    index::discard(repo.git_handle(), repo.path(), &[star], delete_file).unwrap();
    let read = |p: &str| fs::read_to_string(repo.path().join(p)).unwrap();
    assert_eq!(read("*"), "original\n");
    assert_eq!(read("other.txt"), "precious\n");
}

#[test]
fn discard_stops_if_the_file_cannot_be_kept() {
    let repo = TestRepo::new();
    repo.write("edit.txt", "original\n");
    repo.commit_all("initial");
    repo.write("edit.txt", "precious\n");

    let err = index::discard(repo.git_handle(), repo.path(), &files(&repo), |_| {
        Err(std::io::Error::other("trash unavailable"))
    })
    .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Unknown);
    assert_eq!(
        fs::read_to_string(repo.path().join("edit.txt")).unwrap(),
        "precious\n"
    );
}

#[test]
fn diff_combines_staged_and_unstaged_changes() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\ntwo\nthree\n");
    repo.commit_all("initial");
    repo.write("a.txt", "one\nTWO\nthree\n");
    repo.git(["add", "a.txt"]);
    repo.write("a.txt", "one\nTWO\nthree\nfour\n");

    let file = find(&files(&repo), "a.txt").clone();
    let FileDiff::Text { hunks, .. } =
        diff::file_diff(repo.git_handle(), repo.path(), &file).unwrap()
    else {
        panic!("expected text diff");
    };
    let changed: Vec<(LineKind, &str)> = hunks[0]
        .lines
        .iter()
        .filter(|l| l.kind != LineKind::Context)
        .map(|l| (l.kind, l.text.as_str()))
        .collect();
    assert_eq!(
        changed,
        [
            (LineKind::Deleted, "two"),
            (LineKind::Added, "TWO"),
            (LineKind::Added, "four"),
        ]
    );
}

#[test]
fn diff_of_untracked_and_unborn_files() {
    let repo = TestRepo::new();
    repo.write("new.txt", "hello\nworld\n");
    let file = find(&files(&repo), "new.txt").clone();
    let FileDiff::Text { hunks, .. } =
        diff::file_diff(repo.git_handle(), repo.path(), &file).unwrap()
    else {
        panic!("expected text diff");
    };
    assert_eq!(hunks[0].lines.len(), 2);
    assert!(hunks[0].lines.iter().all(|l| l.kind == LineKind::Added));

    // Staged on an unborn branch: diffed against the empty tree.
    repo.git(["add", "new.txt"]);
    let file = find(&files(&repo), "new.txt").clone();
    assert!(matches!(
        diff::file_diff(repo.git_handle(), repo.path(), &file).unwrap(),
        FileDiff::Text { .. }
    ));
}

#[test]
fn diff_detects_binary_files() {
    let repo = TestRepo::new();
    repo.write("image.bin", [0u8, 159, 146, 150, 0, 1, 2]);
    repo.commit_all("initial");
    repo.write("image.bin", [0u8, 1, 2, 3, 0, 9]);
    let file = find(&files(&repo), "image.bin").clone();
    assert_eq!(
        diff::file_diff(repo.git_handle(), repo.path(), &file).unwrap(),
        FileDiff::Binary
    );
    assert_eq!(
        blob::head_blob(repo.git_handle(), repo.path(), "image.bin").unwrap(),
        Some(vec![0u8, 159, 146, 150, 0, 1, 2])
    );
    assert_eq!(
        blob::head_blob(repo.git_handle(), repo.path(), "missing").unwrap(),
        None
    );
}

#[test]
fn commit_amend_and_head() {
    let repo = TestRepo::new();
    assert_eq!(
        commit::head_commit(repo.git_handle(), repo.path()).unwrap(),
        None
    );

    repo.write("a.txt", "1\n");
    index::stage(repo.git_handle(), repo.path(), &files(&repo)).unwrap();
    let message = commit::format_message(
        "#12 첫 커밋",
        "설명입니다",
        &[CoAuthor {
            name: "Pair".into(),
            email: "pair@example.com".into(),
        }],
    );
    let oid = commit::commit(repo.git_handle(), repo.path(), &message, false).unwrap();

    let head = commit::head_commit(repo.git_handle(), repo.path())
        .unwrap()
        .unwrap();
    assert_eq!(head.oid, oid);
    // A leading '#' must survive (it is not treated as a comment).
    assert_eq!(head.summary, "#12 첫 커밋");
    assert_eq!(
        head.body,
        "설명입니다\n\nCo-authored-by: Pair <pair@example.com>"
    );

    let amended = commit::commit(repo.git_handle(), repo.path(), "Better summary\n", true).unwrap();
    assert_ne!(amended, oid);
    let count = repo.git(["rev-list", "--count", "HEAD"]);
    assert_eq!(count.stdout_str().trim(), "1");
}

#[test]
fn committing_nothing_is_a_clear_error() {
    let repo = TestRepo::new();
    repo.commit_all("initial");
    let err = commit::commit(repo.git_handle(), repo.path(), "Empty\n", false).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NothingToCommit);
}

#[test]
fn reads_identity_with_repository_override() {
    let repo = TestRepo::new();
    let id = identity::get(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(id.effective.name.as_deref(), Some("Garam Test"));
    assert!(id.effective.is_complete());
    assert!(!id.is_overridden());

    repo.git(["config", "user.name", "Repo Local"]);
    let id = identity::get(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(id.effective.name.as_deref(), Some("Repo Local"));
    assert_eq!(id.local.name.as_deref(), Some("Repo Local"));
    assert_eq!(id.inherited.name.as_deref(), Some("Garam Test"));
    assert!(id.is_overridden());

    identity::set_global(repo.git_handle(), "새 이름", "new@example.com").unwrap();
    repo.git(["config", "--unset", "user.name"]);
    let id = identity::get(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(id.effective.name.as_deref(), Some("새 이름"));
    assert_eq!(id.effective.email.as_deref(), Some("new@example.com"));
}

#[test]
fn sets_and_clears_repository_identity() {
    let repo = TestRepo::new();
    let git = repo.git_handle();
    identity::set_local(git, repo.path(), " 김지훈 ", "kim@example.com").unwrap();

    let id = identity::get(git, repo.path()).unwrap();
    assert_eq!(id.local.name.as_deref(), Some("김지훈"));
    assert_eq!(id.local.email.as_deref(), Some("kim@example.com"));
    assert_eq!(id.inherited.email.as_deref(), Some("test@garam.invalid"));

    // Commits use the repository's identity, also from the command line.
    repo.write("a.txt", "a");
    repo.commit_all("first");
    let author = repo.git(["log", "-1", "--format=%an <%ae>"]);
    assert_eq!(author.stdout_str().trim(), "김지훈 <kim@example.com>");

    identity::clear_local(git, repo.path()).unwrap();
    // Clearing twice is fine.
    identity::clear_local(git, repo.path()).unwrap();
    let id = identity::get(git, repo.path()).unwrap();
    assert!(!id.is_overridden());
    assert_eq!(id.effective.email.as_deref(), Some("test@garam.invalid"));
}

#[test]
fn one_off_overrides_are_not_repository_identity() {
    let repo = TestRepo::new();
    let git = repo
        .git_handle()
        .clone()
        .with_env("GIT_CONFIG_COUNT", "1")
        .with_env("GIT_CONFIG_KEY_0", "user.email")
        .with_env("GIT_CONFIG_VALUE_0", "once@example.com");
    let id = identity::get(&git, repo.path()).unwrap();
    assert_eq!(id.effective.email.as_deref(), Some("once@example.com"));
    assert_eq!(id.local.email, None);
    assert_eq!(id.inherited.email.as_deref(), Some("test@garam.invalid"));
}
