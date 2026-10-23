use std::fs;

use garam_git::conflict::{self, ConflictKind, Operation, Side};
use garam_git::testing::TestRepo;
use garam_git::{CancelToken, ErrorKind, branch, log};

fn read(repo: &TestRepo, path: &str) -> String {
    fs::read_to_string(repo.path().join(path)).unwrap()
}

fn head_parents(repo: &TestRepo) -> usize {
    repo.git(["rev-list", "--parents", "-n1", "HEAD"])
        .stdout_str()
        .split_whitespace()
        .count()
        - 1
}

/// `main` and `topic` both edit `a.txt`; merging `topic` conflicts.
fn merge_conflict() -> TestRepo {
    let repo = TestRepo::new();
    repo.write("a.txt", "base\n");
    repo.write("other.txt", "other\n");
    repo.commit_all("base");
    repo.git(["switch", "--quiet", "-c", "topic"]);
    repo.write("a.txt", "theirs\n");
    repo.commit_all("topic edit");
    repo.git(["switch", "--quiet", "main"]);
    repo.write("a.txt", "mine\n");
    repo.commit_all("main edit");
    let err = branch::merge(repo.git_handle(), repo.path(), "topic").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::MergeConflict);
    repo
}

fn state(repo: &TestRepo) -> conflict::ConflictState {
    conflict::state(repo.git_handle(), repo.path()).unwrap()
}

#[test]
fn clean_repository_has_no_conflicts() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("a");
    assert_eq!(state(&repo), conflict::ConflictState::default());
}

#[test]
fn detects_a_stopped_merge() {
    let repo = merge_conflict();
    let s = state(&repo);
    assert_eq!(s.operation, Some(Operation::Merge));
    assert_eq!(s.files.len(), 1);
    assert_eq!(s.files[0].path, "a.txt");
    assert_eq!(s.files[0].kind, ConflictKind::BothModified);
    assert!(s.files[0].has_markers);
}

#[test]
fn keeps_my_version_and_continues_the_merge() {
    let repo = merge_conflict();
    let err = conflict::continue_operation(repo.git_handle(), repo.path()).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::ConflictsRemain);

    conflict::resolve(repo.git_handle(), repo.path(), "a.txt", Side::Mine).unwrap();
    assert_eq!(read(&repo, "a.txt"), "mine\n");
    assert!(state(&repo).files.is_empty());

    conflict::continue_operation(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(state(&repo), conflict::ConflictState::default());
    assert_eq!(head_parents(&repo), 2, "merge commit");
}

#[test]
fn keeps_their_version() {
    let repo = merge_conflict();
    conflict::resolve(repo.git_handle(), repo.path(), "a.txt", Side::Theirs).unwrap();
    assert_eq!(read(&repo, "a.txt"), "theirs\n");
}

#[test]
fn marks_a_hand_edited_file_resolved() {
    let repo = merge_conflict();
    repo.write("a.txt", "both\n");
    conflict::mark_resolved(repo.git_handle(), repo.path(), "a.txt").unwrap();
    assert!(state(&repo).files.is_empty());
    conflict::continue_operation(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(read(&repo, "a.txt"), "both\n");
}

#[test]
fn aborting_restores_the_branch() {
    let repo = merge_conflict();
    let before = repo.git(["rev-parse", "HEAD"]).stdout_str().into_owned();
    conflict::abort(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(state(&repo), conflict::ConflictState::default());
    assert_eq!(read(&repo, "a.txt"), "mine\n");
    assert_eq!(repo.git(["rev-parse", "HEAD"]).stdout_str(), before);

    let err = conflict::abort(repo.git_handle(), repo.path()).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NothingInProgress);
}

#[test]
fn modify_delete_conflicts_name_the_deleting_side() {
    let repo = TestRepo::new();
    repo.write("a.txt", "base\n");
    repo.commit_all("base");
    repo.git(["switch", "--quiet", "-c", "topic"]);
    repo.git(["rm", "--quiet", "a.txt"]);
    repo.commit_all("delete on topic");
    repo.git(["switch", "--quiet", "main"]);
    repo.write("a.txt", "edited\n");
    repo.commit_all("edit on main");
    branch::merge(repo.git_handle(), repo.path(), "topic").unwrap_err();

    let s = state(&repo);
    assert_eq!(s.files[0].kind, ConflictKind::DeletedByThem);
    assert!(!s.files[0].has_markers);

    // Taking their side means taking the deletion.
    conflict::resolve(repo.git_handle(), repo.path(), "a.txt", Side::Theirs).unwrap();
    assert!(!repo.path().join("a.txt").exists());
    conflict::continue_operation(repo.git_handle(), repo.path()).unwrap();
}

#[test]
fn rebase_sides_follow_the_user_not_git() {
    let repo = TestRepo::new();
    repo.write("a.txt", "base\n");
    repo.commit_all("base");
    repo.git(["switch", "--quiet", "-c", "topic"]);
    repo.write("a.txt", "my work\n");
    repo.commit_all("my work");
    repo.git(["switch", "--quiet", "main"]);
    repo.write("a.txt", "upstream\n");
    repo.commit_all("upstream");
    repo.git(["switch", "--quiet", "topic"]);
    let out = repo
        .git_handle()
        .command()
        .cwd(repo.path())
        .args(["rebase", "main"])
        .run_unchecked()
        .unwrap();
    assert!(!out.success());

    let s = state(&repo);
    assert_eq!(s.operation, Some(Operation::Rebase));
    conflict::resolve(repo.git_handle(), repo.path(), "a.txt", Side::Mine).unwrap();
    assert_eq!(read(&repo, "a.txt"), "my work\n");

    conflict::continue_operation(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(state(&repo).operation, None);
    let history = log::list(
        repo.git_handle(),
        repo.path(),
        &Default::default(),
        0,
        3,
        &CancelToken::new(),
    )
    .unwrap();
    let summaries: Vec<_> = history.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, ["my work", "upstream", "base"]);
}

#[test]
fn continues_a_conflicted_revert() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    repo.write("a.txt", "two\n");
    let change = repo.commit_all("change");
    repo.write("a.txt", "three\n");
    repo.commit_all("later");
    log::revert(repo.git_handle(), repo.path(), &change).unwrap_err();
    assert_eq!(state(&repo).operation, Some(Operation::Revert));

    repo.write("a.txt", "one\n");
    conflict::mark_resolved(repo.git_handle(), repo.path(), "a.txt").unwrap();
    conflict::continue_operation(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(state(&repo).operation, None);
    let head = log::list(
        repo.git_handle(),
        repo.path(),
        &Default::default(),
        0,
        1,
        &CancelToken::new(),
    )
    .unwrap();
    assert_eq!(head[0].summary, "Revert \"change\"");
}

#[test]
fn continuing_needs_an_operation() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("a");
    let err = conflict::continue_operation(repo.git_handle(), repo.path()).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NothingInProgress);
}

fn summaries(repo: &TestRepo, count: u32) -> Vec<String> {
    log::list(
        repo.git_handle(),
        repo.path(),
        &Default::default(),
        0,
        count,
        &CancelToken::new(),
    )
    .unwrap()
    .into_iter()
    .map(|c| c.summary)
    .collect()
}

/// `main` edits `a.txt`; `topic` edits it differently, then adds `b.txt`.
fn diverged() -> TestRepo {
    let repo = TestRepo::new();
    repo.write("a.txt", "base\n");
    repo.commit_all("base");
    repo.git(["switch", "--quiet", "-c", "topic"]);
    repo.write("a.txt", "topic\n");
    repo.commit_all("topic edit");
    repo.write("b.txt", "b\n");
    repo.commit_all("add b");
    repo.git(["switch", "--quiet", "main"]);
    repo.write("a.txt", "main\n");
    repo.commit_all("main edit");
    repo
}

#[test]
fn a_merge_resolved_to_nothing_is_not_empty() {
    let repo = merge_conflict();
    conflict::resolve(repo.git_handle(), repo.path(), "a.txt", Side::Mine).unwrap();
    assert!(!state(&repo).empty, "a merge commit may be empty");
}

#[test]
fn skips_a_cherry_pick_resolved_to_nothing() {
    let repo = diverged();
    let head = repo.git(["rev-parse", "HEAD"]).stdout_str().into_owned();
    let pick = repo
        .git(["rev-parse", "topic~1"])
        .stdout_str()
        .trim()
        .to_owned();
    let err = log::cherry_pick(repo.git_handle(), repo.path(), &pick).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::CherryPickConflict);
    assert!(!state(&repo).empty, "conflicts remain");

    conflict::resolve(repo.git_handle(), repo.path(), "a.txt", Side::Mine).unwrap();
    let s = state(&repo);
    assert_eq!(s.operation, Some(Operation::CherryPick));
    assert!(s.empty);
    // git won't make the empty commit, so continuing can't finish.
    assert!(!conflict::continue_operation(repo.git_handle(), repo.path()).unwrap());
    assert!(state(&repo).empty);

    assert!(conflict::skip(repo.git_handle(), repo.path()).unwrap());
    assert_eq!(state(&repo), conflict::ConflictState::default());
    assert_eq!(repo.git(["rev-parse", "HEAD"]).stdout_str(), head);
}

#[test]
fn skips_a_revert_resolved_to_nothing() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    repo.write("a.txt", "two\n");
    let change = repo.commit_all("change");
    repo.write("a.txt", "three\n");
    repo.commit_all("later");
    log::revert(repo.git_handle(), repo.path(), &change).unwrap_err();

    conflict::resolve(repo.git_handle(), repo.path(), "a.txt", Side::Mine).unwrap();
    assert!(state(&repo).empty);
    assert!(conflict::skip(repo.git_handle(), repo.path()).unwrap());
    assert_eq!(state(&repo), conflict::ConflictState::default());
    assert_eq!(summaries(&repo, 1), ["later"]);
}

#[test]
fn skipping_a_rebase_commit_goes_on_with_the_rest() {
    let repo = diverged();
    repo.git(["switch", "--quiet", "topic"]);
    let out = repo
        .git_handle()
        .command()
        .cwd(repo.path())
        .args(["rebase", "main"])
        .run_unchecked()
        .unwrap();
    assert!(!out.success());

    // Keeping upstream's side leaves "topic edit" with nothing to add.
    conflict::resolve(repo.git_handle(), repo.path(), "a.txt", Side::Theirs).unwrap();
    assert!(state(&repo).empty);
    assert!(conflict::skip(repo.git_handle(), repo.path()).unwrap());
    assert_eq!(state(&repo).operation, None);
    assert_eq!(summaries(&repo, 3), ["add b", "main edit", "base"]);
}

#[test]
fn stops_again_at_a_later_commit_that_would_be_empty() {
    let repo = diverged();
    // main already has topic's second commit.
    repo.write("b.txt", "b\n");
    repo.commit_all("b on main");
    let picks = [
        repo.git(["rev-parse", "topic~1"])
            .stdout_str()
            .trim()
            .to_owned(),
        repo.git(["rev-parse", "topic"])
            .stdout_str()
            .trim()
            .to_owned(),
    ];
    let err = log::cherry_pick_many(repo.git_handle(), repo.path(), &picks).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::CherryPickConflict);

    conflict::resolve(repo.git_handle(), repo.path(), "a.txt", Side::Mine).unwrap();
    assert!(!conflict::skip(repo.git_handle(), repo.path()).unwrap());
    let s = state(&repo);
    assert_eq!(s.operation, Some(Operation::CherryPick));
    assert!(s.empty);

    assert!(conflict::skip(repo.git_handle(), repo.path()).unwrap());
    assert_eq!(state(&repo), conflict::ConflictState::default());
    assert_eq!(summaries(&repo, 1), ["b on main"]);
}

#[test]
fn skipping_keeps_uncommitted_changes() {
    let repo = diverged();
    let pick = repo
        .git(["rev-parse", "topic~1"])
        .stdout_str()
        .trim()
        .to_owned();
    log::cherry_pick(repo.git_handle(), repo.path(), &pick).unwrap_err();
    conflict::resolve(repo.git_handle(), repo.path(), "a.txt", Side::Mine).unwrap();
    repo.write("a.txt", "edited after resolving\n");
    assert!(!state(&repo).empty);

    let err = conflict::skip(repo.git_handle(), repo.path()).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::UncommittedChanges);
    assert_eq!(read(&repo, "a.txt"), "edited after resolving\n");
}
