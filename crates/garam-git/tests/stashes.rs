use std::fs;

use garam_git::branch::{self, SwitchMode};
use garam_git::stash::{self, ApplyOutcome};
use garam_git::status::ChangeKind;
use garam_git::testing::TestRepo;
use garam_git::{ErrorKind, diff::FileDiff};

fn read(repo: &TestRepo, path: &str) -> String {
    fs::read_to_string(repo.path().join(path)).unwrap()
}

/// `a.txt` committed as "base".
fn repo() -> TestRepo {
    let repo = TestRepo::new();
    repo.write("a.txt", "base\n");
    repo.commit_all("base");
    repo
}

fn push(repo: &TestRepo, message: Option<&str>) -> String {
    stash::push(repo.git_handle(), repo.path(), message, true, &[]).unwrap()
}

fn short_status(repo: &TestRepo) -> String {
    repo.git(["status", "--short"]).stdout_str().into_owned()
}

#[test]
fn lists_stashes_newest_first() {
    let repo = repo();
    repo.write("a.txt", "one\n");
    let first = push(&repo, Some("first"));
    repo.write("a.txt", "two\n");
    repo.write("new.txt", "new\n");
    let second = push(&repo, None);

    let list = stash::list(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].oid, second);
    assert_eq!(list[0].name, "stash@{0}");
    assert_eq!(list[0].message, None, "git made up a WIP message");
    assert!(list[0].has_untracked);
    assert_eq!(list[1].oid, first);
    assert_eq!(list[1].message.as_deref(), Some("first"));
    assert_eq!(list[1].branch.as_deref(), Some("main"));
    assert!(!list[1].has_untracked);
    assert!(!list[1].auto);
    let head = repo
        .git(["rev-parse", "HEAD"])
        .stdout_str()
        .trim()
        .to_owned();
    assert_eq!(list[1].base, head);
}

#[test]
fn lists_auto_stashes_from_switching_branches() {
    let repo = repo();
    repo.git(["branch", "other"]);
    repo.write("a.txt", "work\n");
    let other = branch::list(repo.git_handle(), repo.path())
        .unwrap()
        .into_iter()
        .find(|b| b.name == "other")
        .unwrap();
    branch::switch(
        repo.git_handle(),
        repo.path(),
        &other,
        SwitchMode::LeaveChanges,
        Some("main"),
    )
    .unwrap();

    let list = stash::list(repo.git_handle(), repo.path()).unwrap();
    assert!(list[0].auto);
    let auto = stash::find_auto(repo.git_handle(), repo.path(), "main")
        .unwrap()
        .unwrap();
    assert_eq!(auto.oid, list[0].oid);
}

#[test]
fn says_when_there_is_nothing_to_stash() {
    let repo = repo();
    let err = stash::push(repo.git_handle(), repo.path(), None, true, &[]).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NothingToStash);

    // Untracked files only go with include_untracked.
    repo.write("new.txt", "new\n");
    let err = stash::push(repo.git_handle(), repo.path(), None, false, &[]).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NothingToStash);
    assert!(repo.path().join("new.txt").exists());
}

#[test]
fn stashes_only_the_chosen_files() {
    let repo = repo();
    // `[...]` is the one glob syntax Windows allows in file names. As a
    // pattern, `b[x].txt` would match `bx.txt` and `u[1].txt` `u1.txt`.
    repo.write("b[x].txt", "b\n");
    repo.write("bx.txt", "bx\n");
    repo.commit_all("b");
    repo.write("a.txt", "a changed\n");
    repo.write("b[x].txt", "b changed\n");
    repo.write("bx.txt", "bx changed\n");
    repo.write("u[1].txt", "untracked\n");
    repo.write("u1.txt", "other untracked\n");

    // Names with glob characters mean only themselves.
    let paths = ["b[x].txt".to_owned(), "u[1].txt".to_owned()];
    let oid = stash::push(repo.git_handle(), repo.path(), Some("some"), true, &paths).unwrap();
    assert_eq!(short_status(&repo), " M a.txt\n M bx.txt\n?? u1.txt\n");

    let files = stash::files(repo.git_handle(), repo.path(), &oid).unwrap();
    let names: Vec<_> = files.iter().map(|f| (f.path.as_str(), f.kind)).collect();
    assert_eq!(
        names,
        [
            ("b[x].txt", ChangeKind::Modified),
            ("u[1].txt", ChangeKind::Untracked)
        ]
    );
}

#[test]
fn shows_tracked_and_untracked_changes() {
    let repo = repo();
    repo.write("a.txt", "changed\n");
    repo.write("dir/new.txt", "brand new\n");
    let oid = push(&repo, None);

    let files = stash::files(repo.git_handle(), repo.path(), &oid).unwrap();
    assert_eq!(files.len(), 2);
    for file in &files {
        let FileDiff::Text { hunks, .. } =
            stash::file_diff(repo.git_handle(), repo.path(), &oid, file, false).unwrap()
        else {
            panic!("text diff expected");
        };
        let text: Vec<_> = hunks
            .iter()
            .flat_map(|h| h.lines.iter())
            .map(|l| l.text.as_str())
            .collect();
        match file.path.as_str() {
            "a.txt" => assert_eq!(text, ["base", "changed"]),
            "dir/new.txt" => {
                assert_eq!(file.kind, ChangeKind::Untracked);
                assert_eq!(text, ["brand new"]);
            }
            other => panic!("unexpected {other}"),
        }
    }
}

#[test]
fn pops_and_restores_what_was_staged() {
    let repo = repo();
    repo.write("a.txt", "staged\n");
    repo.git(["add", "a.txt"]);
    repo.write("new.txt", "new\n");
    let oid = push(&repo, None);
    assert_eq!(short_status(&repo), "");

    let outcome = stash::apply(repo.git_handle(), repo.path(), &oid, true).unwrap();
    assert_eq!(outcome, ApplyOutcome::Applied);
    assert_eq!(short_status(&repo), "M  a.txt\n?? new.txt\n");
    assert!(
        stash::list(repo.git_handle(), repo.path())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn applying_keeps_the_stash() {
    let repo = repo();
    repo.write("a.txt", "changed\n");
    let oid = push(&repo, None);
    stash::apply(repo.git_handle(), repo.path(), &oid, false).unwrap();
    assert_eq!(read(&repo, "a.txt"), "changed\n");
    assert_eq!(
        stash::list(repo.git_handle(), repo.path()).unwrap().len(),
        1
    );
}

#[test]
fn finds_a_stash_by_id_after_others_are_added() {
    let repo = repo();
    repo.write("a.txt", "first\n");
    let first = push(&repo, Some("first"));
    repo.write("a.txt", "second\n");
    push(&repo, Some("second"));

    stash::apply(repo.git_handle(), repo.path(), &first, true).unwrap();
    assert_eq!(read(&repo, "a.txt"), "first\n");
    let left = stash::list(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].message.as_deref(), Some("second"));
}

#[test]
fn a_conflict_leaves_the_stash_even_when_popping() {
    let repo = repo();
    repo.write("a.txt", "stashed\n");
    let oid = push(&repo, None);
    repo.write("a.txt", "committed meanwhile\n");
    repo.commit_all("meanwhile");

    let outcome = stash::apply(repo.git_handle(), repo.path(), &oid, true).unwrap();
    assert_eq!(outcome, ApplyOutcome::Conflicted);
    assert_eq!(short_status(&repo), "UU a.txt\n");
    assert_eq!(
        stash::list(repo.git_handle(), repo.path()).unwrap().len(),
        1
    );
}

#[test]
fn applies_unstaged_when_the_staged_part_no_longer_fits() {
    let repo = repo();
    repo.write("a.txt", "staged\n");
    repo.git(["add", "a.txt"]);
    let oid = stash::push(repo.git_handle(), repo.path(), None, false, &[]).unwrap();
    repo.write("a.txt", "different\n");
    repo.commit_all("meanwhile");

    let outcome = stash::apply(repo.git_handle(), repo.path(), &oid, false).unwrap();
    // The working tree side merges (with a conflict here); nothing is lost.
    assert!(matches!(
        outcome,
        ApplyOutcome::AppliedUnstaged | ApplyOutcome::Conflicted
    ));
    assert!(read(&repo, "a.txt").contains("staged"));
}

#[test]
fn an_existing_untracked_file_stops_everything() {
    let repo = repo();
    repo.write("a.txt", "changed\n");
    repo.write("new.txt", "stashed\n");
    let oid = push(&repo, None);
    repo.write("new.txt", "made meanwhile\n");

    let err = stash::apply(repo.git_handle(), repo.path(), &oid, true).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::StashUntrackedExists);
    assert_eq!(read(&repo, "new.txt"), "made meanwhile\n");
    assert_eq!(read(&repo, "a.txt"), "base\n", "nothing applied");
    assert_eq!(
        stash::list(repo.git_handle(), repo.path()).unwrap().len(),
        1
    );
}

#[test]
fn refuses_to_overwrite_uncommitted_changes() {
    let repo = repo();
    repo.write("a.txt", "stashed\n");
    let oid = push(&repo, None);
    repo.write("a.txt", "local\n");

    let err = stash::apply(repo.git_handle(), repo.path(), &oid, true).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::LocalChangesWouldBeOverwritten);
    assert_eq!(read(&repo, "a.txt"), "local\n");
}

#[test]
fn drops_and_restores_a_stash() {
    let repo = repo();
    repo.write("a.txt", "kept\n");
    let oid = push(&repo, Some("keep me"));

    stash::drop(repo.git_handle(), repo.path(), &oid).unwrap();
    assert!(
        stash::list(repo.git_handle(), repo.path())
            .unwrap()
            .is_empty()
    );
    let err = stash::drop(repo.git_handle(), repo.path(), &oid).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::StashNotFound);

    stash::restore(repo.git_handle(), repo.path(), &oid).unwrap();
    let list = stash::list(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(list[0].oid, oid);
    assert_eq!(list[0].message.as_deref(), Some("keep me"));
    assert_eq!(list[0].branch.as_deref(), Some("main"));
}

#[test]
fn restores_on_a_new_branch_where_it_was_made() {
    let repo = repo();
    repo.write("a.txt", "stashed\n");
    let oid = push(&repo, None);
    repo.write("a.txt", "committed meanwhile\n");
    repo.commit_all("meanwhile");

    stash::branch(repo.git_handle(), repo.path(), &oid, "rescue").unwrap();
    assert_eq!(
        repo.git(["branch", "--show-current"]).stdout_str().trim(),
        "rescue"
    );
    assert_eq!(read(&repo, "a.txt"), "stashed\n");
    assert!(
        stash::list(repo.git_handle(), repo.path())
            .unwrap()
            .is_empty()
    );

    let err = stash::branch(repo.git_handle(), repo.path(), &oid, "bad name").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::InvalidBranchName);
}
