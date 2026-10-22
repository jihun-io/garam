use garam_git::conflict::{self, Operation};
use garam_git::log::{self, ResetMode};
use garam_git::testing::TestRepo;
use garam_git::{ErrorKind, status, tag};

fn rev(repo: &TestRepo, rev: &str) -> String {
    repo.git(["rev-parse", rev]).stdout_str().trim().to_owned()
}

fn subject(repo: &TestRepo, rev: &str) -> String {
    repo.git(["log", "-1", "--format=%s", rev])
        .stdout_str()
        .trim()
        .to_owned()
}

/// main: base → "main work"; feature (from base): "feature work" on f.txt.
fn branched_repo() -> TestRepo {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    repo.git(["switch", "--quiet", "-c", "feature"]);
    repo.write("f.txt", "feature\n");
    repo.commit_all("feature work");
    repo.git(["switch", "--quiet", "main"]);
    repo.write("a.txt", "one\ntwo\n");
    repo.commit_all("main work");
    repo
}

#[test]
fn cherry_picks_a_commit_onto_head() {
    let repo = branched_repo();
    let feature = rev(&repo, "feature");
    log::cherry_pick(repo.git_handle(), repo.path(), &feature).unwrap();
    assert_eq!(subject(&repo, "HEAD"), "feature work");
    assert_eq!(subject(&repo, "HEAD~1"), "main work");
    assert!(repo.path().join("f.txt").exists());
}

#[test]
fn cherry_pick_conflicts_stay_in_progress() {
    let repo = branched_repo();
    repo.git(["switch", "--quiet", "feature"]);
    repo.write("a.txt", "one\nTHREE\n");
    repo.commit_all("clashing work");
    let clash = rev(&repo, "HEAD");
    repo.git(["switch", "--quiet", "main"]);

    let err = log::cherry_pick(repo.git_handle(), repo.path(), &clash).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::CherryPickConflict);
    let state = conflict::state(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(state.operation, Some(Operation::CherryPick));
    assert_eq!(state.files.len(), 1);
}

#[test]
fn empty_cherry_pick_is_undone() {
    let repo = branched_repo();
    let main_work = rev(&repo, "HEAD");
    // Picking a commit HEAD already contains changes nothing.
    repo.git(["switch", "--quiet", "-c", "copy", "feature"]);
    log::cherry_pick(repo.git_handle(), repo.path(), &main_work).unwrap();
    let before = rev(&repo, "HEAD");

    let err = log::cherry_pick(repo.git_handle(), repo.path(), &main_work).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::CherryPickEmpty);
    assert_eq!(rev(&repo, "HEAD"), before);
    let state = conflict::state(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(state.operation, None, "nothing left in progress");
}

#[test]
fn resets_soft_mixed_and_hard() {
    let repo = branched_repo();
    let base = rev(&repo, "HEAD~1");
    let main_work = rev(&repo, "HEAD");
    let git = repo.git_handle();

    log::reset(git, repo.path(), &base, ResetMode::Soft).unwrap();
    assert_eq!(rev(&repo, "HEAD"), base);
    let files = status::status(git, repo.path()).unwrap().files;
    assert!(files[0].staged.is_some(), "soft keeps the change staged");

    log::reset(git, repo.path(), &main_work, ResetMode::Hard).unwrap();
    log::reset(git, repo.path(), &base, ResetMode::Mixed).unwrap();
    let files = status::status(git, repo.path()).unwrap().files;
    assert!(
        files[0].staged.is_none() && files[0].unstaged.is_some(),
        "mixed unstages"
    );

    log::reset(git, repo.path(), &base, ResetMode::Hard).unwrap();
    assert!(status::status(git, repo.path()).unwrap().files.is_empty());
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
        "one\n"
    );

    assert!(log::reset(git, repo.path(), "HEAD~1", ResetMode::Hard).is_err());
}

#[test]
fn undoes_the_last_commit_keeping_its_changes() {
    let repo = branched_repo();
    repo.git([
        "commit",
        "--quiet",
        "--amend",
        "-m",
        "main work",
        "-m",
        "Why.",
    ]);
    let head = rev(&repo, "HEAD");
    let git = repo.git_handle();

    let undone = log::undo_last_commit(git, repo.path(), &head).unwrap();
    assert_eq!(undone.summary, "main work");
    assert_eq!(undone.body, "Why.");
    assert_eq!(subject(&repo, "HEAD"), "base");
    let files = status::status(git, repo.path()).unwrap().files;
    assert_eq!(files[0].path, "a.txt");
    assert!(files[0].staged.is_some(), "changes stay staged");

    // HEAD is no longer that commit.
    let err = log::undo_last_commit(git, repo.path(), &head).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::HeadMoved);
}

#[test]
fn undoing_the_first_commit_leaves_an_unborn_branch() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    let first = repo.commit_all("first");
    log::undo_last_commit(repo.git_handle(), repo.path(), &first).unwrap();
    let status = status::status(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(status.branch.head.as_deref(), Some("main"));
    assert_eq!(status.branch.oid, None);
    assert!(status.files[0].staged.is_some());
}

#[test]
fn checks_out_a_commit_detached() {
    let repo = branched_repo();
    let base = rev(&repo, "HEAD~1");
    log::checkout(repo.git_handle(), repo.path(), &base).unwrap();
    let status = status::status(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(status.branch.head, None);
    assert_eq!(status.branch.oid.as_deref(), Some(base.as_str()));
}

#[test]
fn creates_plain_and_annotated_tags() {
    let repo = branched_repo();
    let base = rev(&repo, "HEAD~1");
    let git = repo.git_handle();

    tag::create(git, repo.path(), "v1.0", &base, None).unwrap();
    assert_eq!(rev(&repo, "v1.0"), base);
    assert_eq!(
        repo.git(["cat-file", "-t", "v1.0"]).stdout_str().trim(),
        "commit"
    );

    tag::create(git, repo.path(), "v1.1", &base, Some("  First release  \n")).unwrap();
    assert_eq!(
        repo.git(["cat-file", "-t", "v1.1"]).stdout_str().trim(),
        "tag"
    );
    assert_eq!(
        repo.git(["tag", "-l", "--format=%(contents:subject)", "v1.1"])
            .stdout_str()
            .trim(),
        "First release"
    );

    let err = tag::create(git, repo.path(), "v1.0", &base, None).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::TagExists);
    for bad in ["", "-v", "a..b", "has space", "end."] {
        let err = tag::create(git, repo.path(), bad, &base, None).unwrap_err();
        assert_eq!(err.kind(), ErrorKind::InvalidTagName, "{bad:?}");
    }
}

/// main: base → one → two → three, each adding a file.
fn linear() -> TestRepo {
    let repo = TestRepo::new();
    repo.write("base.txt", "base\n");
    repo.commit_all("base");
    for name in ["one", "two", "three"] {
        repo.write(format!("{name}.txt"), format!("{name}\n"));
        repo.commit_all(name);
    }
    repo
}

fn subjects(repo: &TestRepo) -> Vec<String> {
    repo.git(["log", "--format=%s"])
        .stdout_str()
        .lines()
        .map(str::to_owned)
        .collect()
}

#[test]
fn cherry_picks_several_skipping_changes_already_there() {
    let repo = branched_repo();
    repo.git(["switch", "--quiet", "feature"]);
    repo.write("g.txt", "g\n");
    repo.commit_all("more feature");
    repo.git(["switch", "--quiet", "main"]);
    let main_work = rev(&repo, "main");
    let picks = [rev(&repo, "feature~1"), rev(&repo, "feature"), main_work];

    let outcome = log::cherry_pick_many(repo.git_handle(), repo.path(), &picks).unwrap();
    assert_eq!((outcome.picked, outcome.skipped), (2, 1));
    assert_eq!(
        subjects(&repo)[..3],
        ["more feature", "feature work", "main work"]
    );
    let state = conflict::state(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(state.operation, None);
}

#[test]
fn reverts_several_newest_first() {
    let repo = linear();
    let oids = [rev(&repo, "HEAD"), rev(&repo, "HEAD~1")];
    log::revert_many(repo.git_handle(), repo.path(), &oids).unwrap();
    assert_eq!(subjects(&repo)[..2], ["Revert \"two\"", "Revert \"three\""]);
    assert!(!repo.path().join("two.txt").exists());
    assert!(repo.path().join("one.txt").exists());
}

#[test]
fn squashes_the_latest_commits_into_one() {
    let repo = linear();
    let oids = [rev(&repo, "HEAD"), rev(&repo, "HEAD~1")];
    let tree = rev(&repo, "HEAD^{tree}");
    let new = log::squash(
        repo.git_handle(),
        repo.path(),
        &oids,
        "two and three\n\nBoth.",
    )
    .unwrap();
    assert_eq!(rev(&repo, "HEAD"), new);
    assert_eq!(subjects(&repo), ["two and three", "one", "base"]);
    assert_eq!(rev(&repo, "HEAD^{tree}"), tree, "same files");
    let body = repo
        .git(["log", "-1", "--format=%b"])
        .stdout_str()
        .trim()
        .to_owned();
    assert_eq!(body, "Both.");
}

#[test]
fn squashes_earlier_commits_and_replays_the_rest() {
    let repo = linear();
    let oids = [rev(&repo, "HEAD~2"), rev(&repo, "HEAD~1")];
    log::squash(repo.git_handle(), repo.path(), &oids, "one and two").unwrap();
    assert_eq!(subjects(&repo), ["three", "one and two", "base"]);
    for name in ["one", "two", "three"] {
        assert!(repo.path().join(format!("{name}.txt")).exists());
    }
}

#[test]
fn refuses_squashes_that_would_need_more_than_a_replay() {
    let repo = linear();
    let git = repo.git_handle();
    let err = |oids: &[String]| log::squash(git, repo.path(), oids, "x").unwrap_err().kind();

    // Not next to each other.
    assert_eq!(
        err(&[rev(&repo, "HEAD"), rev(&repo, "HEAD~2")]),
        ErrorKind::CannotSquash
    );
    // Just one.
    assert_eq!(err(&[rev(&repo, "HEAD")]), ErrorKind::CannotSquash);
    // Later commits to replay over uncommitted changes.
    repo.write("three.txt", "changed\n");
    assert_eq!(
        err(&[rev(&repo, "HEAD~2"), rev(&repo, "HEAD~1")]),
        ErrorKind::UncommittedChanges
    );
    repo.git(["checkout", "--quiet", "--", "three.txt"]);

    // A merge after the range.
    repo.git(["switch", "--quiet", "-c", "side", "HEAD~1"]);
    repo.write("s.txt", "s\n");
    repo.commit_all("side");
    repo.git(["switch", "--quiet", "main"]);
    repo.git(["merge", "--quiet", "--no-ff", "-m", "merge", "side"]);
    assert_eq!(
        err(&[rev(&repo, "HEAD~2"), rev(&repo, "HEAD~3")]),
        ErrorKind::CannotSquash
    );
    assert_eq!(subjects(&repo)[0], "merge", "nothing changed");
}

#[test]
fn cherry_picks_from_here_onto_another_branch() {
    let repo = branched_repo();
    let main_work = rev(&repo, "main");
    let git = repo.git_handle();

    let outcome = log::cherry_pick_onto(git, repo.path(), "feature", &[main_work]).unwrap();
    assert_eq!(outcome.picked, 1);
    let status = status::status(git, repo.path()).unwrap();
    assert_eq!(
        status.branch.head.as_deref(),
        Some("feature"),
        "stays on the target"
    );
    assert_eq!(subjects(&repo)[..2], ["main work", "feature work"]);
}

#[test]
fn cherry_picking_onto_another_branch_needs_a_clean_tree() {
    let repo = branched_repo();
    let main_work = rev(&repo, "main");
    let git = repo.git_handle();
    repo.write("a.txt", "dirty\n");

    let err = log::cherry_pick_onto(
        git,
        repo.path(),
        "feature",
        std::slice::from_ref(&main_work),
    )
    .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::UncommittedChanges);
    let status = status::status(git, repo.path()).unwrap();
    assert_eq!(status.branch.head.as_deref(), Some("main"), "didn't switch");

    let err = log::cherry_pick_onto(git, repo.path(), "--detach", &[main_work]).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::InvalidBranchName);
}

#[test]
fn reorders_the_latest_commits() {
    let repo = linear();
    let (three, two, one) = (
        rev(&repo, "HEAD"),
        rev(&repo, "HEAD~1"),
        rev(&repo, "HEAD~2"),
    );
    // Move "one" to the top.
    log::reorder(repo.git_handle(), repo.path(), &[one, three, two]).unwrap();
    assert_eq!(subjects(&repo), ["one", "three", "two", "base"]);
    for name in ["one", "two", "three"] {
        assert!(repo.path().join(format!("{name}.txt")).exists());
    }
    let state = conflict::state(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(state.operation, None);
}

#[test]
fn reorders_down_to_the_first_commit() {
    let repo = linear();
    let order: Vec<_> = ["HEAD~3", "HEAD", "HEAD~1", "HEAD~2"]
        .iter()
        .map(|r| rev(&repo, r))
        .collect();
    log::reorder(repo.git_handle(), repo.path(), &order).unwrap();
    assert_eq!(subjects(&repo), ["base", "three", "two", "one"]);
}

#[test]
fn reorder_conflicts_stop_the_rebase() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("base");
    repo.write("a.txt", "a\nb\n");
    repo.commit_all("add b");
    repo.write("a.txt", "a\nb\nc\n");
    repo.commit_all("add c");
    let order = [rev(&repo, "HEAD~1"), rev(&repo, "HEAD")];
    let err = log::reorder(repo.git_handle(), repo.path(), &order).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::RebaseConflict);
    let state = conflict::state(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(state.operation, Some(Operation::Rebase));
}

#[test]
fn refuses_reorders_it_cannot_do_cleanly() {
    let repo = linear();
    let git = repo.git_handle();
    let err = |order: &[String]| log::reorder(git, repo.path(), order).unwrap_err().kind();
    let (three, two, one) = (
        rev(&repo, "HEAD"),
        rev(&repo, "HEAD~1"),
        rev(&repo, "HEAD~2"),
    );

    // Not the newest commits.
    assert_eq!(err(&[one.clone(), two.clone()]), ErrorKind::CannotReorder);
    // Just one.
    assert_eq!(err(std::slice::from_ref(&three)), ErrorKind::CannotReorder);
    // Uncommitted changes.
    repo.write("one.txt", "changed\n");
    assert_eq!(
        err(&[two.clone(), three.clone()]),
        ErrorKind::UncommittedChanges
    );
    repo.git(["checkout", "--quiet", "--", "one.txt"]);
    // Same order: nothing to do.
    log::reorder(git, repo.path(), &[three, two, one]).unwrap();
    assert_eq!(subjects(&repo), ["three", "two", "one", "base"]);
}
