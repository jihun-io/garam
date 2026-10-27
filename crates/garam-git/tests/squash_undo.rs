use garam_git::testing::TestRepo;
use garam_git::{ErrorKind, conflict, log, squash_undo};

fn rev(repo: &TestRepo, name: &str) -> String {
    repo.git(["rev-parse", name]).stdout_str().trim().to_owned()
}

fn linear() -> (TestRepo, Vec<String>) {
    let repo = TestRepo::new();
    let mut oids = vec![];
    for name in ["base", "target", "between", "dragged"] {
        repo.write(format!("{name}.txt"), format!("{name}\n"));
        oids.push(repo.commit_all(name));
    }
    (repo, oids)
}

fn squash(repo: &TestRepo, oids: &[String]) -> squash_undo::SquashUndo {
    log::squash_onto(
        repo.git_handle(),
        repo.path(),
        &oids[3..],
        &oids[1],
        &oids[3],
        "main",
        "Combined",
    )
    .unwrap();
    squash_undo::preview(repo.git_handle(), repo.path())
        .unwrap()
        .unwrap()
}

#[test]
fn undoes_nonadjacent_squash_and_retains_both_histories_through_gc() {
    let (repo, oids) = linear();
    let info = squash(&repo, &oids);
    assert!(info.available);
    assert_eq!(info.count, 2);
    assert!(!info.content_changed);
    repo.write("local untracked.txt", "keep\n");
    // The record is durable, including after reflog expiry and Git GC.
    repo.git(["reflog", "expire", "--expire=now", "--all"]);
    repo.git(["gc", "--prune=now"]);
    let reopened = squash_undo::preview(repo.git_handle(), repo.path())
        .unwrap()
        .unwrap();
    assert_eq!(info.id, reopened.id);
    squash_undo::undo(repo.git_handle(), repo.path(), &info.id).unwrap();
    assert_eq!(rev(&repo, "HEAD"), oids[3]);
    assert_eq!(rev(&repo, "HEAD~1"), oids[2]);
    assert_eq!(rev(&repo, "HEAD~2"), oids[1]);
    assert!(
        squash_undo::preview(repo.git_handle(), repo.path())
            .unwrap()
            .is_none()
    );
    repo.git(["reflog", "expire", "--expire=now", "--all"]);
    repo.git(["gc", "--prune=now"]);
    assert_eq!(rev(&repo, &info.after), info.after);
    let lost = garam_git::compare::lost_commits(repo.git_handle(), repo.path()).unwrap();
    assert!(lost.iter().any(|entry| entry.commit.oid == info.after));
    assert_eq!(
        std::fs::read_to_string(repo.path().join("local untracked.txt")).unwrap(),
        "keep\n"
    );
    assert_eq!(
        squash_undo::undo(repo.git_handle(), repo.path(), &info.id)
            .unwrap_err()
            .kind(),
        ErrorKind::SquashUndoUnavailable
    );
}

#[test]
fn also_tracks_selection_menu_squashes() {
    let (repo, oids) = linear();
    log::squash(repo.git_handle(), repo.path(), &oids[1..3], "Together").unwrap();
    let info = squash_undo::preview(repo.git_handle(), repo.path())
        .unwrap()
        .unwrap();
    assert_eq!(info.before, oids[3]);
    squash_undo::undo(repo.git_handle(), repo.path(), &info.id).unwrap();
    assert_eq!(rev(&repo, "HEAD"), oids[3]);
}

#[test]
fn refuses_new_commits_branch_switches_and_detached_head() {
    let (repo, oids) = linear();
    let info = squash(&repo, &oids);
    repo.git(["switch", "-c", "other"]);
    assert!(
        !squash_undo::preview(repo.git_handle(), repo.path())
            .unwrap()
            .unwrap()
            .available
    );
    assert_eq!(
        squash_undo::undo(repo.git_handle(), repo.path(), &info.id)
            .unwrap_err()
            .kind(),
        ErrorKind::HeadMoved
    );
    repo.git(["switch", "main"]);
    repo.git(["checkout", "--detach"]);
    assert_eq!(
        squash_undo::undo(repo.git_handle(), repo.path(), &info.id)
            .unwrap_err()
            .kind(),
        ErrorKind::HeadMoved
    );
    repo.git(["switch", "main"]);
    let head = repo.commit_all("Later commit");
    assert_eq!(
        squash_undo::undo(repo.git_handle(), repo.path(), &info.id)
            .unwrap_err()
            .kind(),
        ErrorKind::HeadMoved
    );
    assert_eq!(rev(&repo, "HEAD"), head);
}

#[test]
fn refuses_staged_and_unstaged_changes_preserving_the_exact_index() {
    for stage in [true, false] {
        let (repo, oids) = linear();
        let info = squash(&repo, &oids);
        repo.write("base.txt", "new local work\n");
        if stage {
            repo.git(["add", "base.txt"]);
        }
        let tree = repo.git(["write-tree"]).stdout_str().trim().to_owned();
        assert_eq!(
            squash_undo::undo(repo.git_handle(), repo.path(), &info.id)
                .unwrap_err()
                .kind(),
            ErrorKind::UncommittedChanges
        );
        assert_eq!(rev(&repo, "HEAD"), info.after);
        assert_eq!(repo.git(["write-tree"]).stdout_str().trim(), tree);
        assert_eq!(
            std::fs::read_to_string(repo.path().join("base.txt")).unwrap(),
            "new local work\n"
        );
    }
}

#[test]
fn stale_notices_cannot_undo_a_newer_squash_and_failed_squashes_keep_the_last_record() {
    let (repo, oids) = linear();
    let first = squash(&repo, &oids);
    assert!(log::squash(repo.git_handle(), repo.path(), &[], "No").is_err());
    assert_eq!(
        squash_undo::preview(repo.git_handle(), repo.path())
            .unwrap()
            .unwrap()
            .id,
        first.id
    );
    log::squash(
        repo.git_handle(),
        repo.path(),
        &[rev(&repo, "HEAD"), rev(&repo, "HEAD~1")],
        "Newer",
    )
    .unwrap();
    let second = squash_undo::preview(repo.git_handle(), repo.path())
        .unwrap()
        .unwrap();
    assert_ne!(first.id, second.id);
    assert_eq!(
        squash_undo::undo(repo.git_handle(), repo.path(), &first.id)
            .unwrap_err()
            .kind(),
        ErrorKind::SquashUndoUnavailable
    );
    assert_eq!(rev(&repo, "HEAD"), second.after);
}

fn conflict_repo() -> (TestRepo, String) {
    let repo = TestRepo::new();
    repo.write("file.txt", "base\n");
    repo.commit_all("Base");
    repo.write("target.txt", "target\n");
    let target = repo.commit_all("Target");
    repo.write("file.txt", "middle\n");
    repo.commit_all("Middle");
    repo.write("file.txt", "last\n");
    let before = repo.commit_all("Last");
    assert!(
        log::squash_onto(
            repo.git_handle(),
            repo.path(),
            std::slice::from_ref(&before),
            &target,
            &before,
            "main",
            "Combined"
        )
        .is_err()
    );
    assert_eq!(
        conflict::state(repo.git_handle(), repo.path())
            .unwrap()
            .operation,
        Some(conflict::Operation::Rebase)
    );
    (repo, before)
}

fn resolve_all(repo: &TestRepo, from_terminal: bool) {
    for _ in 0..3 {
        if conflict::state(repo.git_handle(), repo.path())
            .unwrap()
            .operation
            .is_none()
        {
            return;
        }
        repo.write("file.txt", "resolved\n");
        repo.git(["add", "file.txt"]);
        if from_terminal {
            let _ = repo
                .git_handle()
                .command()
                .cwd(repo.path())
                .env("GIT_EDITOR", "true")
                .args(["rebase", "--continue"])
                .run();
        } else {
            let _ = conflict::continue_operation(repo.git_handle(), repo.path());
        }
    }
    assert!(
        conflict::state(repo.git_handle(), repo.path())
            .unwrap()
            .operation
            .is_none()
    );
}

#[test]
fn conflict_results_can_be_undone_after_continue_in_app_or_terminal() {
    for from_terminal in [false, true] {
        let (repo, before) = conflict_repo();
        assert!(
            squash_undo::preview(repo.git_handle(), repo.path())
                .unwrap()
                .is_none()
        );
        resolve_all(&repo, from_terminal);
        let info = squash_undo::preview(repo.git_handle(), repo.path())
            .unwrap()
            .unwrap();
        assert!(info.content_changed);
        assert!(info.available);
        assert_eq!(info.before, before);
        squash_undo::undo(repo.git_handle(), repo.path(), &info.id).unwrap();
        assert_eq!(rev(&repo, "HEAD"), before);
        assert_eq!(
            std::fs::read_to_string(repo.path().join("file.txt")).unwrap(),
            "last\n"
        );
        assert_eq!(
            repo.git(["show", &format!("{}:file.txt", info.after)])
                .stdout_str(),
            "resolved\n"
        );
    }
}

#[test]
fn aborting_a_conflicted_squash_never_offers_undo_for_it() {
    let (repo, before) = conflict_repo();
    conflict::abort(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(rev(&repo, "HEAD"), before);
    assert!(
        squash_undo::preview(repo.git_handle(), repo.path())
            .unwrap()
            .is_none()
    );
}

#[test]
fn worktrees_have_separate_undo_records_and_branches() {
    let (repo, oids) = linear();
    let info = squash(&repo, &oids);
    let worktree = TestRepo::plain_dir();
    repo.git([
        "worktree",
        "add",
        "-b",
        "other",
        worktree.path().to_str().unwrap(),
    ]);
    assert!(
        squash_undo::preview(repo.git_handle(), worktree.path())
            .unwrap()
            .is_none()
    );
    log::squash(
        repo.git_handle(),
        worktree.path(),
        &[rev(&repo, "HEAD"), rev(&repo, "HEAD~1")],
        "Other squash",
    )
    .unwrap();
    let other = squash_undo::preview(repo.git_handle(), worktree.path())
        .unwrap()
        .unwrap();
    assert_ne!(info.id, other.id);
    squash_undo::undo(repo.git_handle(), repo.path(), &info.id).unwrap();
    assert_eq!(rev(&repo, "HEAD"), oids[3]);
    assert_eq!(rev(&repo, "other"), other.after);
}

#[test]
fn untracked_files_are_not_overwritten_when_restoring_a_different_tree() {
    for ignored in [false, true] {
        let (repo, before) = conflict_repo();
        repo.write("file.txt", "resolved\n");
        repo.git(["add", "file.txt"]);
        assert!(conflict::continue_operation(repo.git_handle(), repo.path()).is_err());
        repo.git(["rm", "--", "file.txt"]);
        conflict::continue_operation(repo.git_handle(), repo.path()).unwrap();
        let info = squash_undo::preview(repo.git_handle(), repo.path())
            .unwrap()
            .unwrap();
        assert_eq!(info.before, before);
        assert!(!repo.path().join("file.txt").exists());
        if ignored {
            repo.write(".git/info/exclude", "file.txt\n");
        }
        repo.write("file.txt", "new local file\n");
        assert!(squash_undo::undo(repo.git_handle(), repo.path(), &info.id).is_err());
        assert_eq!(rev(&repo, "HEAD"), info.after);
        assert_eq!(
            std::fs::read_to_string(repo.path().join("file.txt")).unwrap(),
            "new local file\n"
        );
    }
}

#[test]
fn undo_never_changes_the_remote_branch_or_publishes_backups() {
    let (repo, oids) = linear();
    let remote = TestRepo::bare();
    repo.git(["remote", "add", "origin", remote.path().to_str().unwrap()]);
    let info = squash(&repo, &oids);
    repo.git(["push", "--set-upstream", "origin", "main"]);
    squash_undo::undo(repo.git_handle(), repo.path(), &info.id).unwrap();
    assert_eq!(rev(&repo, "HEAD"), oids[3]);
    assert_eq!(rev(&remote, "main"), info.after);
    assert!(
        remote
            .git(["for-each-ref", "refs/garam/"])
            .stdout
            .is_empty()
    );
}
