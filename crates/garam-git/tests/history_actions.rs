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
