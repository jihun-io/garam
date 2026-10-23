use std::fs;

use garam_git::branch::{self, BranchKind, MergeOutcome, SwitchMode};
use garam_git::testing::TestRepo;
use garam_git::{ErrorKind, stash, status};

fn current(repo: &TestRepo) -> Option<String> {
    status::status(repo.git_handle(), repo.path())
        .unwrap()
        .branch
        .head
}

fn find(repo: &TestRepo, name: &str) -> branch::Branch {
    branch::list(repo.git_handle(), repo.path())
        .unwrap()
        .into_iter()
        .find(|b| b.name == name)
        .unwrap_or_else(|| panic!("no branch {name}"))
}

fn changed_files(repo: &TestRepo) -> usize {
    status::status(repo.git_handle(), repo.path())
        .unwrap()
        .files
        .len()
}

fn repo_with_commit() -> TestRepo {
    let repo = TestRepo::new();
    repo.write("file.txt", "base\n");
    repo.commit_all("initial");
    repo
}

#[test]
fn creates_and_lists_branches() {
    let repo = repo_with_commit();
    branch::create(repo.git_handle(), repo.path(), "feature/한글-작업", None).unwrap();
    assert_eq!(current(&repo).as_deref(), Some("feature/한글-작업"));

    let branches = branch::list(repo.git_handle(), repo.path()).unwrap();
    let names: Vec<_> = branches.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(names, ["feature/한글-작업", "main"]);
    assert!(branches[0].is_head);
    assert_eq!(branches[1].subject, "initial");
    assert!(branches[1].committed_at > 0);
}

#[test]
fn rejects_invalid_and_duplicate_names() {
    let repo = repo_with_commit();
    for bad in ["has space", "double..dot", "end.lock", "-dash", "a~b"] {
        let err = branch::create(repo.git_handle(), repo.path(), bad, None).unwrap_err();
        assert_eq!(err.kind(), ErrorKind::InvalidBranchName, "{bad}");
    }
    let err = branch::create(repo.git_handle(), repo.path(), "main", None).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::BranchExists);
}

#[test]
fn switching_brings_changes_along() {
    let repo = repo_with_commit();
    branch::create(repo.git_handle(), repo.path(), "other", None).unwrap();
    branch::switch(
        repo.git_handle(),
        repo.path(),
        &find(&repo, "main"),
        SwitchMode::BringChanges,
        Some("other"),
    )
    .unwrap();
    repo.write("file.txt", "edited\n");

    branch::switch(
        repo.git_handle(),
        repo.path(),
        &find(&repo, "other"),
        SwitchMode::BringChanges,
        Some("main"),
    )
    .unwrap();
    assert_eq!(current(&repo).as_deref(), Some("other"));
    assert_eq!(changed_files(&repo), 1);
}

#[test]
fn switching_refuses_to_overwrite_changes() {
    let repo = repo_with_commit();
    branch::create(repo.git_handle(), repo.path(), "other", None).unwrap();
    repo.write("file.txt", "on other\n");
    repo.commit_all("change on other");
    branch::switch(
        repo.git_handle(),
        repo.path(),
        &find(&repo, "main"),
        SwitchMode::BringChanges,
        Some("other"),
    )
    .unwrap();
    repo.write("file.txt", "uncommitted on main\n");

    let err = branch::switch(
        repo.git_handle(),
        repo.path(),
        &find(&repo, "other"),
        SwitchMode::BringChanges,
        Some("main"),
    )
    .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::LocalChangesWouldBeOverwritten);
    assert_eq!(current(&repo).as_deref(), Some("main"));
}

#[test]
fn leaving_changes_stashes_them_for_later() {
    let repo = repo_with_commit();
    branch::create(repo.git_handle(), repo.path(), "other", None).unwrap();
    repo.write("file.txt", "work in progress\n");
    repo.write("new.txt", "untracked too\n");

    branch::switch(
        repo.git_handle(),
        repo.path(),
        &find(&repo, "main"),
        SwitchMode::LeaveChanges,
        Some("other"),
    )
    .unwrap();
    assert_eq!(current(&repo).as_deref(), Some("main"));
    assert_eq!(changed_files(&repo), 0);
    assert_eq!(
        stash::find_auto(repo.git_handle(), repo.path(), "main").unwrap(),
        None
    );

    let stash = stash::find_auto(repo.git_handle(), repo.path(), "other")
        .unwrap()
        .expect("stash for other");
    branch::switch(
        repo.git_handle(),
        repo.path(),
        &find(&repo, "other"),
        SwitchMode::BringChanges,
        Some("main"),
    )
    .unwrap();
    stash::apply(repo.git_handle(), repo.path(), &stash.oid, true).unwrap();
    assert_eq!(
        fs::read_to_string(repo.path().join("file.txt")).unwrap(),
        "work in progress\n"
    );
    assert!(repo.path().join("new.txt").exists());
    assert_eq!(
        stash::find_auto(repo.git_handle(), repo.path(), "other").unwrap(),
        None
    );
}

#[test]
fn leaving_with_nothing_to_stash_does_not_touch_old_stashes() {
    let repo = repo_with_commit();
    repo.write("file.txt", "older user stash\n");
    repo.git(["stash", "push", "-m", "mine"]);
    branch::create(repo.git_handle(), repo.path(), "other", None).unwrap();

    // Clean tree + a switch that fails: nothing of the user's may be popped.
    let mut missing = find(&repo, "main");
    missing.name = "does-not-exist".into();
    branch::switch(
        repo.git_handle(),
        repo.path(),
        &missing,
        SwitchMode::LeaveChanges,
        Some("other"),
    )
    .unwrap_err();
    assert_eq!(changed_files(&repo), 0);
    let stashes = repo.git(["stash", "list"]);
    assert!(stashes.stdout_str().contains("mine"));
}

#[test]
fn renames_and_deletes() {
    let repo = repo_with_commit();
    branch::create(repo.git_handle(), repo.path(), "topic", None).unwrap();
    repo.write("topic.txt", "unmerged work\n");
    repo.commit_all("topic work");
    branch::rename(repo.git_handle(), repo.path(), "topic", "renamed").unwrap();
    assert_eq!(current(&repo).as_deref(), Some("renamed"));

    branch::switch(
        repo.git_handle(),
        repo.path(),
        &find(&repo, "main"),
        SwitchMode::BringChanges,
        Some("renamed"),
    )
    .unwrap();
    let err = branch::delete(repo.git_handle(), repo.path(), "renamed", false).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::BranchNotMerged);
    branch::delete(repo.git_handle(), repo.path(), "renamed", true).unwrap();
    assert_eq!(
        branch::list(repo.git_handle(), repo.path()).unwrap().len(),
        1
    );
}

#[test]
fn branch_names_that_look_like_options_stay_names() {
    // git refuses to create these, but a tampered repository can hold them.
    let repo = repo_with_commit();
    repo.write("dash.txt", "x\n");
    repo.commit_all("dash work");
    repo.git(["update-ref", "refs/heads/-D", "HEAD"]);
    repo.git(["update-ref", "refs/heads/-q", "HEAD"]);
    repo.git(["reset", "--hard", "HEAD~"]);

    branch::switch(
        repo.git_handle(),
        repo.path(),
        &find(&repo, "-D"),
        SwitchMode::BringChanges,
        Some("main"),
    )
    .unwrap();
    assert_eq!(current(&repo).as_deref(), Some("-D"));
    branch::switch(
        repo.git_handle(),
        repo.path(),
        &find(&repo, "main"),
        SwitchMode::BringChanges,
        Some("-D"),
    )
    .unwrap();

    assert_eq!(
        branch::merge(repo.git_handle(), repo.path(), "-D").unwrap(),
        MergeOutcome::FastForward
    );
    branch::rename(repo.git_handle(), repo.path(), "-D", "was-dash").unwrap();
    branch::delete(repo.git_handle(), repo.path(), "-q", false).unwrap();
    let names: Vec<_> = branch::list(repo.git_handle(), repo.path())
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert_eq!(names, ["main", "was-dash"]);
}

#[test]
fn merges_with_each_outcome() {
    let repo = repo_with_commit();
    branch::create(repo.git_handle(), repo.path(), "ff", None).unwrap();
    repo.write("ff.txt", "x\n");
    repo.commit_all("ff work");
    let main = find(&repo, "main");
    branch::switch(
        repo.git_handle(),
        repo.path(),
        &main,
        SwitchMode::BringChanges,
        None,
    )
    .unwrap();

    assert_eq!(
        branch::commits_to_merge(repo.git_handle(), repo.path(), "ff").unwrap(),
        1
    );
    assert_eq!(
        branch::merge(repo.git_handle(), repo.path(), "ff").unwrap(),
        MergeOutcome::FastForward
    );
    assert_eq!(
        branch::merge(repo.git_handle(), repo.path(), "ff").unwrap(),
        MergeOutcome::UpToDate
    );

    // Diverged: a real merge commit.
    branch::create(repo.git_handle(), repo.path(), "side", None).unwrap();
    repo.write("side.txt", "s\n");
    repo.commit_all("side work");
    branch::switch(
        repo.git_handle(),
        repo.path(),
        &find(&repo, "main"),
        SwitchMode::BringChanges,
        None,
    )
    .unwrap();
    repo.write("main.txt", "m\n");
    repo.commit_all("main work");
    assert_eq!(
        branch::merge(repo.git_handle(), repo.path(), "side").unwrap(),
        MergeOutcome::Merged
    );
}

#[test]
fn merge_conflicts_are_reported() {
    let repo = repo_with_commit();
    branch::create(repo.git_handle(), repo.path(), "a", None).unwrap();
    repo.write("file.txt", "from a\n");
    repo.commit_all("a");
    branch::switch(
        repo.git_handle(),
        repo.path(),
        &find(&repo, "main"),
        SwitchMode::BringChanges,
        None,
    )
    .unwrap();
    repo.write("file.txt", "from main\n");
    repo.commit_all("main");

    let err = branch::merge(repo.git_handle(), repo.path(), "a").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::MergeConflict);
    let files = status::status(repo.git_handle(), repo.path())
        .unwrap()
        .files;
    assert!(files[0].is_conflicted());
}

#[test]
fn switches_to_a_remote_branch_by_tracking_it() {
    let upstream = repo_with_commit();
    branch::create(upstream.git_handle(), upstream.path(), "remote-only", None).unwrap();
    upstream.git(["switch", "--quiet", "main"]);
    let clone_root = TestRepo::plain_dir();
    let dest = clone_root.path().join("clone");
    clone_root.git([
        "clone",
        "--quiet",
        &upstream.path().display().to_string(),
        "clone",
    ]);
    let remote = branch::list(clone_root.git_handle(), &dest)
        .unwrap()
        .into_iter()
        .find(|b| b.name == "origin/remote-only")
        .unwrap();
    assert_eq!(remote.kind, BranchKind::Remote);
    branch::switch(
        clone_root.git_handle(),
        &dest,
        &remote,
        SwitchMode::BringChanges,
        None,
    )
    .unwrap();

    let local = branch::list(clone_root.git_handle(), &dest)
        .unwrap()
        .into_iter()
        .find(|b| b.name == "remote-only")
        .unwrap();
    assert!(local.is_head);
    assert_eq!(local.upstream.as_deref(), Some("origin/remote-only"));

    // Picking origin/main while a local main exists switches to that main.
    let origin_main = branch::list(clone_root.git_handle(), &dest)
        .unwrap()
        .into_iter()
        .find(|b| b.name == "origin/main")
        .unwrap();
    branch::switch(
        clone_root.git_handle(),
        &dest,
        &origin_main,
        SwitchMode::BringChanges,
        None,
    )
    .unwrap();
    let head = status::status(clone_root.git_handle(), &dest)
        .unwrap()
        .branch
        .head;
    assert_eq!(head.as_deref(), Some("main"));
}

#[test]
fn creates_a_branch_from_an_older_commit() {
    let repo = repo_with_commit();
    let first = repo
        .git(["rev-parse", "HEAD"])
        .stdout_str()
        .trim()
        .to_owned();
    repo.write("file.txt", "second\n");
    repo.commit_all("second");

    branch::create(repo.git_handle(), repo.path(), "from-first", Some(&first)).unwrap();
    assert_eq!(current(&repo).as_deref(), Some("from-first"));
    assert_eq!(
        fs::read_to_string(repo.path().join("file.txt")).unwrap(),
        "base\n"
    );
    assert!(branch::create(repo.git_handle(), repo.path(), "x", Some("--orphan")).is_err());
}
