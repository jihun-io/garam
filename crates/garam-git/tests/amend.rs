use garam_git::amend::{self, AmendEdit};
use garam_git::diff::{FileDiff, LineKind};
use garam_git::patch::LineRef;
use garam_git::testing::TestRepo;
use garam_git::{ErrorKind, FileChange};

// Windows forbids asterisks in filenames; retain Unicode, spaces and literal brackets there.
const SPECIAL_PATH: &str = if cfg!(windows) {
    "한글 [x].txt"
} else {
    "한글 [x]*.txt"
};

fn rev(repo: &TestRepo, name: &str) -> String {
    repo.git(["rev-parse", name]).stdout_str().trim().into()
}
fn file(repo: &TestRepo, id: &str, path: &str) -> FileChange {
    amend::status(repo.git_handle(), repo.path(), id)
        .unwrap()
        .files
        .into_iter()
        .find(|f| f.path == path)
        .unwrap()
}
fn include(repo: &TestRepo, id: &str, path: &str, include: bool) {
    amend::edit(
        repo.git_handle(),
        repo.path(),
        id,
        AmendEdit::Files {
            files: vec![file(repo, id, path)],
            include,
        },
    )
    .unwrap();
}

#[test]
fn excludes_committed_files_adds_new_files_and_leaves_excluded_changes_in_the_worktree() {
    let repo = TestRepo::new();
    repo.write("base.txt", "before\n");
    repo.commit_all("base");
    repo.write("base.txt", "committed\n");
    repo.write("remove-from-commit.txt", "keep on disk\n");
    let head = repo.commit_all("feat: original\n\nCo-authored-by: Friend <friend@example.com>");
    repo.write("new.txt", "new\n");
    repo.git(["add", "new.txt"]);
    repo.write("base.txt", "unstaged\n");
    let original_index = repo.git(["write-tree"]).stdout;
    let session = amend::begin(repo.git_handle(), repo.path(), &head).unwrap();
    let files = amend::status(repo.git_handle(), repo.path(), &session.id)
        .unwrap()
        .files;
    assert_eq!(files.len(), 3);
    assert!(files.iter().all(|f| f.staged.is_some()));
    include(&repo, &session.id, "remove-from-commit.txt", false);
    assert_eq!(repo.git(["write-tree"]).stdout, original_index);
    assert_eq!(rev(&repo, "HEAD"), head);
    let updated = amend::save(
        repo.git_handle(),
        repo.path(),
        &session.id,
        "feat: corrected\n\nCo-authored-by: Friend <friend@example.com>",
    )
    .unwrap();
    assert_eq!(rev(&repo, "HEAD"), updated);
    assert_ne!(updated, head);
    assert_eq!(
        repo.git(["show", "HEAD:base.txt"]).stdout_str(),
        "committed\n"
    );
    assert_eq!(repo.git(["show", "HEAD:new.txt"]).stdout_str(), "new\n");
    assert_eq!(
        std::fs::read_to_string(repo.path().join("base.txt")).unwrap(),
        "unstaged\n"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("remove-from-commit.txt")).unwrap(),
        "keep on disk\n"
    );
    assert!(
        !repo
            .git(["ls-tree", "--name-only", "HEAD"])
            .stdout_str()
            .contains("remove-from-commit")
    );
    assert!(repo.git(["diff", "--cached"]).stdout.is_empty());
    assert!(
        repo.git(["reflog", "--format=%H"])
            .stdout_str()
            .contains(&head)
    );
}

#[test]
fn root_commit_can_exclude_individual_lines_and_keep_an_empty_commit() {
    let repo = TestRepo::new();
    repo.write(SPECIAL_PATH, "one\ntwo\nthree\n");
    let head = repo.commit_all("root");
    let session = amend::begin(repo.git_handle(), repo.path(), &head).unwrap();
    let f = file(&repo, &session.id, SPECIAL_PATH);
    let diff = amend::file_diff(repo.git_handle(), repo.path(), &session.id, &f).unwrap();
    let FileDiff::Text { hunks, selectable } = diff else {
        panic!("expected text");
    };
    assert!(selectable);
    assert!(hunks.iter().flat_map(|h| &h.lines).all(|l| l.staged));
    amend::edit(
        repo.git_handle(),
        repo.path(),
        &session.id,
        AmendEdit::Lines {
            file: f,
            selected: vec![LineRef {
                kind: LineKind::Added,
                line: 2,
            }],
        },
    )
    .unwrap();
    amend::save(repo.git_handle(), repo.path(), &session.id, "root changed").unwrap();
    assert_eq!(
        repo.git(["show", &format!("HEAD:{SPECIAL_PATH}")])
            .stdout_str(),
        "two\n"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join(SPECIAL_PATH)).unwrap(),
        "one\ntwo\nthree\n"
    );
    assert_eq!(
        repo.git(["rev-list", "--count", "HEAD"])
            .stdout_str()
            .trim(),
        "1"
    );
    let session = amend::begin(repo.git_handle(), repo.path(), &rev(&repo, "HEAD")).unwrap();
    include(&repo, &session.id, SPECIAL_PATH, false);
    amend::save(repo.git_handle(), repo.path(), &session.id, "empty root").unwrap();
    assert!(repo.git(["ls-tree", "HEAD"]).stdout.is_empty());
}

#[test]
fn cancelling_preserves_the_real_index_exactly_and_every_working_file() {
    let repo = TestRepo::new();
    repo.write("file.txt", "base\n");
    repo.commit_all("base");
    repo.write("file.txt", "committed\n");
    let head = repo.commit_all("head");
    repo.write("file.txt", "staged\n");
    repo.git(["add", "file.txt"]);
    repo.write("file.txt", "unstaged\n");
    let session = amend::begin(repo.git_handle(), repo.path(), &head).unwrap();
    let index = std::fs::read(repo.path().join(".git/index")).unwrap();
    include(&repo, &session.id, "file.txt", false);
    amend::cancel(repo.git_handle(), repo.path(), &session.id).unwrap();
    assert_eq!(
        std::fs::read(repo.path().join(".git/index")).unwrap(),
        index
    );
    assert_eq!(rev(&repo, "HEAD"), head);
    assert_eq!(repo.git(["show", ":file.txt"]).stdout_str(), "staged\n");
    assert_eq!(
        std::fs::read_to_string(repo.path().join("file.txt")).unwrap(),
        "unstaged\n"
    );
}

#[test]
fn saving_refuses_external_head_branch_and_index_changes_but_cancel_still_works() {
    let repo = TestRepo::new();
    repo.write("file.txt", "committed\n");
    let head = repo.commit_all("head");
    let session = amend::begin(repo.git_handle(), repo.path(), &head).unwrap();
    repo.write("file.txt", "external\n");
    repo.git(["add", "file.txt"]);
    assert_eq!(
        amend::save(repo.git_handle(), repo.path(), &session.id, "changed")
            .unwrap_err()
            .kind(),
        ErrorKind::IndexChanged
    );
    assert_eq!(repo.git(["show", ":file.txt"]).stdout_str(), "external\n");
    repo.git(["switch", "-c", "other"]);
    assert_eq!(
        amend::save(repo.git_handle(), repo.path(), &session.id, "changed")
            .unwrap_err()
            .kind(),
        ErrorKind::HeadMoved
    );
    amend::cancel(repo.git_handle(), repo.path(), &session.id).unwrap();
    assert_eq!(rev(&repo, "HEAD"), head);
}

#[test]
fn signing_failure_leaves_head_real_index_and_editable_selection_intact() {
    let repo = TestRepo::new();
    repo.write("file.txt", "committed\n");
    let head = repo.commit_all("head");
    let session = amend::begin(repo.git_handle(), repo.path(), &head).unwrap();
    include(&repo, &session.id, "file.txt", false);
    repo.git(["config", "commit.gpgsign", "true"]);
    repo.git(["config", "gpg.program", "garam-nonexistent-signing-program"]);
    assert!(amend::save(repo.git_handle(), repo.path(), &session.id, "changed").is_err());
    assert_eq!(rev(&repo, "HEAD"), head);
    assert!(repo.git(["diff", "--cached"]).stdout.is_empty());
    assert!(file(&repo, &session.id, "file.txt").staged.is_none());
    assert!(!repo.path().join(".git/index.lock").exists());
}

#[test]
fn rejects_published_merge_and_in_progress_commits() {
    let repo = TestRepo::new();
    let head = repo.commit_all("head");
    repo.git(["update-ref", "refs/remotes/other/main", &head]);
    assert_eq!(
        amend::begin(repo.git_handle(), repo.path(), &head)
            .unwrap_err()
            .kind(),
        ErrorKind::CannotAmend
    );
    repo.git(["update-ref", "-d", "refs/remotes/other/main"]);
    repo.write(".git/MERGE_HEAD", format!("{head}\n"));
    assert_eq!(
        amend::begin(repo.git_handle(), repo.path(), &head)
            .unwrap_err()
            .kind(),
        ErrorKind::CannotAmend
    );
    std::fs::remove_file(repo.path().join(".git/MERGE_HEAD")).unwrap();
    repo.git(["switch", "--detach"]);
    assert_eq!(
        amend::begin(repo.git_handle(), repo.path(), &head)
            .unwrap_err()
            .kind(),
        ErrorKind::DetachedHead
    );
    repo.git(["switch", "main"]);
    repo.git(["switch", "-c", "side"]);
    repo.commit_all("side");
    repo.git(["switch", "main"]);
    repo.commit_all("main");
    repo.git(["merge", "--no-ff", "side", "-m", "merge"]);
    assert_eq!(
        amend::begin(repo.git_handle(), repo.path(), &rev(&repo, "HEAD"))
            .unwrap_err()
            .kind(),
        ErrorKind::CannotAmend
    );
}

#[test]
fn exclusion_restores_deleted_and_renamed_paths_only_in_the_index() {
    let repo = TestRepo::new();
    repo.write("deleted.txt", "restore in commit\n");
    repo.write("old.txt", "rename\n");
    repo.commit_all("base");
    repo.git(["rm", "deleted.txt"]);
    repo.git(["mv", "old.txt", "new.txt"]);
    let head = repo.commit_all("delete and rename");
    let session = amend::begin(repo.git_handle(), repo.path(), &head).unwrap();
    for path in ["deleted.txt", "old.txt", "new.txt"] {
        include(&repo, &session.id, path, false);
    }
    amend::save(
        repo.git_handle(),
        repo.path(),
        &session.id,
        "keep original paths",
    )
    .unwrap();
    assert_eq!(
        repo.git(["show", "HEAD:deleted.txt"]).stdout_str(),
        "restore in commit\n"
    );
    assert_eq!(repo.git(["show", "HEAD:old.txt"]).stdout_str(), "rename\n");
    assert!(!repo.path().join("deleted.txt").exists());
    assert!(!repo.path().join("old.txt").exists());
    assert_eq!(
        std::fs::read_to_string(repo.path().join("new.txt")).unwrap(),
        "rename\n"
    );
    assert!(repo.git(["diff", "--cached"]).stdout.is_empty());
}

#[test]
fn a_locked_index_stops_save_and_a_stat_only_refresh_does_not() {
    let repo = TestRepo::new();
    repo.write("file.txt", "content\n");
    let head = repo.commit_all("head");
    let session = amend::begin(repo.git_handle(), repo.path(), &head).unwrap();
    repo.write(".git/index.lock", "external lock");
    assert!(amend::save(repo.git_handle(), repo.path(), &session.id, "changed").is_err());
    assert_eq!(rev(&repo, "HEAD"), head);
    assert_eq!(
        std::fs::read_to_string(repo.path().join(".git/index.lock")).unwrap(),
        "external lock"
    );
    std::fs::remove_file(repo.path().join(".git/index.lock")).unwrap();
    repo.write("file.txt", "content\n");
    repo.git(["add", "file.txt"]);
    amend::save(repo.git_handle(), repo.path(), &session.id, "changed").unwrap();
    assert_eq!(
        repo.git(["log", "-1", "--format=%s"]).stdout_str().trim(),
        "changed"
    );
}

#[test]
fn editing_a_linked_worktree_does_not_change_the_main_worktree() {
    let repo = TestRepo::new();
    repo.write("file.txt", "one\r\ntwo");
    let head = repo.commit_all("head");
    let path = repo.path().join("linked '한국'");
    repo.git([
        std::ffi::OsStr::new("worktree"),
        std::ffi::OsStr::new("add"),
        std::ffi::OsStr::new("-b"),
        std::ffi::OsStr::new("topic"),
        path.as_os_str(),
    ]);
    let session = amend::begin(repo.git_handle(), &path, &head).unwrap();
    let file = amend::status(repo.git_handle(), &path, &session.id)
        .unwrap()
        .files
        .remove(0);
    amend::edit(
        repo.git_handle(),
        &path,
        &session.id,
        AmendEdit::Lines {
            file,
            selected: vec![LineRef {
                kind: LineKind::Added,
                line: 1,
            }],
        },
    )
    .unwrap();
    let updated = amend::save(repo.git_handle(), &path, &session.id, "partial root").unwrap();
    assert_eq!(rev(&repo, "main"), head);
    assert_eq!(rev(&repo, "topic"), updated);
    assert_eq!(repo.git(["show", "topic:file.txt"]).stdout, b"one\r\n");
    assert_eq!(std::fs::read(path.join("file.txt")).unwrap(), b"one\r\ntwo");
    assert!(repo.git(["diff", "--cached"]).stdout.is_empty());
}

#[test]
fn preserves_index_flags_and_supports_split_indexes() {
    let repo = TestRepo::new();
    repo.write("unchanged.txt", "base\n");
    repo.write("example.txt", "base\n");
    repo.commit_all("base");
    repo.write("example.txt", "committed\n");
    let head = repo.commit_all("head");
    repo.git(["update-index", "--assume-unchanged", "unchanged.txt"]);
    repo.git(["update-index", "--split-index"]);
    let session = amend::begin(repo.git_handle(), repo.path(), &head).unwrap();
    amend::save(repo.git_handle(), repo.path(), &session.id, "corrected").unwrap();
    assert!(
        repo.git(["ls-files", "-v", "--", "unchanged.txt"])
            .stdout_str()
            .starts_with("h ")
    );
    assert!(repo.git(["diff", "--cached"]).stdout.is_empty());
}
