use garam_git::ErrorKind;
use garam_git::branch::{
    self, BaseStatus, CleanupCandidate, CleanupReason, MergeOutcome, MergePreview, UpdateMode,
};
use garam_git::testing::TestRepo;

/// A remote whose `main` holds `f.txt`, a clone of it to work in (with
/// `origin/HEAD` recorded, as a real clone has) and a second clone for
/// someone else's commits.
fn setup() -> (TestRepo, TestRepo, TestRepo) {
    let remote = TestRepo::bare();
    let seed = TestRepo::clone_of(&remote);
    seed.write("f.txt", "a\nb\nc\n");
    seed.commit_all("base");
    seed.git(["push", "--quiet", "origin", "main"]);
    let me = TestRepo::clone_of(&remote);
    (remote, me, seed)
}

fn status(repo: &TestRepo) -> Option<BaseStatus> {
    branch::base_status(repo.git_handle(), repo.path()).unwrap()
}

/// Someone else changes `f.txt`'s second line on `main` and adds a file.
fn others_move_main(other: &TestRepo) {
    other.git(["pull", "--quiet", "origin", "main"]);
    other.write("f.txt", "a\nTHEIRS\nc\n");
    other.commit_all("theirs");
    other.write("g.txt", "g\n");
    other.commit_all("more");
    other.git(["push", "--quiet", "origin", "main"]);
}

#[test]
fn says_nothing_on_the_default_branch() {
    let (_remote, me, _other) = setup();
    assert_eq!(status(&me), None);
}

#[test]
fn tells_how_far_main_moved_and_what_would_conflict() {
    let (_remote, me, other) = setup();
    me.git(["switch", "--quiet", "-c", "feature"]);
    me.write("f.txt", "a\nMINE\nc\n");
    me.commit_all("mine");
    assert_eq!(
        status(&me),
        Some(BaseStatus {
            base: "origin/main".into(),
            base_branch: "main".into(),
            behind: 0,
            conflicts: Some(Vec::new()),
            published: false,
        })
    );

    others_move_main(&other);
    me.git(["fetch", "--quiet"]);
    let found = status(&me).unwrap();
    assert_eq!(found.behind, 2);
    assert_eq!(found.conflicts, Some(vec!["f.txt".to_owned()]));

    me.git(["push", "--quiet", "-u", "origin", "feature"]);
    assert!(status(&me).unwrap().published);
    // Nothing was touched by looking.
    assert_eq!(me.git(["status", "--short"]).stdout_str(), "");
}

#[test]
fn previews_a_merge_without_touching_the_working_tree() {
    let repo = TestRepo::new();
    repo.write("f.txt", "a\nb\nc\n");
    repo.commit_all("base");
    repo.git(["switch", "--quiet", "-c", "side"]);
    repo.write("f.txt", "a\nSIDE\nc\n");
    repo.write("side.txt", "s\n");
    repo.commit_all("side");
    repo.git(["switch", "--quiet", "main"]);
    repo.write("f.txt", "a\nMAIN\nc\n");
    repo.commit_all("main");

    assert_eq!(
        branch::merge_preview(repo.git_handle(), repo.path(), "side").unwrap(),
        MergePreview {
            commits: 1,
            conflicts: Some(vec!["f.txt".to_owned()]),
        }
    );
    assert_eq!(repo.git(["status", "--short"]).stdout_str(), "");
}

#[test]
fn merges_main_in_with_uncommitted_changes_set_aside() {
    let (_remote, me, other) = setup();
    me.git(["switch", "--quiet", "-c", "feature"]);
    me.write("mine.txt", "mine\n");
    me.commit_all("mine");
    others_move_main(&other);
    me.git(["fetch", "--quiet"]);
    me.write("mine.txt", "still editing\n");

    assert_eq!(
        branch::update_from(me.git_handle(), me.path(), "origin/main", UpdateMode::Merge).unwrap(),
        MergeOutcome::Merged
    );
    assert_eq!(status(&me).unwrap().behind, 0);
    assert_eq!(me.git(["status", "--short"]).stdout_str(), " M mine.txt\n");
}

#[test]
fn rebases_an_unpublished_branch_onto_main() {
    let (_remote, me, other) = setup();
    me.git(["switch", "--quiet", "-c", "feature"]);
    me.write("mine.txt", "mine\n");
    me.commit_all("mine");
    others_move_main(&other);
    me.git(["fetch", "--quiet"]);

    assert_eq!(
        branch::update_from(
            me.git_handle(),
            me.path(),
            "origin/main",
            UpdateMode::Rebase
        )
        .unwrap(),
        MergeOutcome::Rebased
    );
    // Linear: the branch's commit sits right on top of main.
    assert_eq!(
        me.git(["rev-parse", "HEAD~1"]).stdout_str(),
        me.git(["rev-parse", "origin/main"]).stdout_str()
    );
    assert_eq!(
        branch::update_from(
            me.git_handle(),
            me.path(),
            "origin/main",
            UpdateMode::Rebase
        )
        .unwrap(),
        MergeOutcome::UpToDate
    );
}

#[test]
fn a_conflicting_merge_is_left_in_progress() {
    let (_remote, me, other) = setup();
    me.git(["switch", "--quiet", "-c", "feature"]);
    me.write("f.txt", "a\nMINE\nc\n");
    me.commit_all("mine");
    others_move_main(&other);
    me.git(["fetch", "--quiet"]);

    let err = branch::update_from(me.git_handle(), me.path(), "origin/main", UpdateMode::Merge)
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::MergeConflict);
    assert!(me.path().join(".git/MERGE_HEAD").exists());
}

#[test]
fn finds_merged_squashed_and_deleted_branches_to_clean_up() {
    let (_remote, me, _other) = setup();
    let new_branch = |name: &str, file: &str| {
        me.git(["switch", "--quiet", "-c", name, "main"]);
        me.write(file, format!("{name}\n"));
        me.commit_all(name);
    };
    new_branch("merged", "merged.txt");
    new_branch("squashed", "squashed.txt");
    new_branch("gone", "gone.txt");
    me.git(["push", "--quiet", "-u", "origin", "gone"]);
    new_branch("open", "open.txt");

    me.git(["switch", "--quiet", "main"]);
    me.git(["merge", "--quiet", "--no-edit", "merged"]);
    me.git(["merge", "--quiet", "--squash", "squashed"]);
    me.git(["commit", "--quiet", "-m", "squash"]);
    me.git(["push", "--quiet", "origin", "main"]);
    // The remote branch is deleted after review, as GitHub does on merge.
    me.git(["push", "--quiet", "origin", "--delete", "gone"]);
    me.git(["fetch", "--quiet", "--prune"]);
    // Made a moment ago and not worked on yet.
    me.git(["branch", "fresh"]);

    let names: Vec<_> = branch::cleanup_candidates(me.git_handle(), me.path())
        .unwrap()
        .into_iter()
        .map(
            |CleanupCandidate {
                 name,
                 reason,
                 unmerged,
                 ..
             }| (name, reason, unmerged),
        )
        .collect();
    assert_eq!(
        names,
        [
            ("gone".to_owned(), CleanupReason::Gone, Some(1)),
            ("merged".to_owned(), CleanupReason::Merged, Some(0)),
            ("squashed".to_owned(), CleanupReason::Merged, Some(0)),
        ]
    );
}

#[test]
fn deleted_branches_come_back_with_their_upstream() {
    let (_remote, me, _other) = setup();
    me.git(["switch", "--quiet", "-c", "feature"]);
    me.write("x.txt", "x\n");
    me.commit_all("x");
    me.git(["push", "--quiet", "-u", "origin", "feature"]);
    me.git(["switch", "--quiet", "main"]);
    let tip = me.git(["rev-parse", "feature"]).stdout_str().into_owned();

    let deleted = branch::delete_many(me.git_handle(), me.path(), &["feature".to_owned()]).unwrap();
    assert!(
        me.git(["branch", "--list", "feature"])
            .stdout_str()
            .is_empty()
    );

    branch::restore(me.git_handle(), me.path(), &deleted).unwrap();
    assert_eq!(me.git(["rev-parse", "feature"]).stdout_str(), tip);
    assert_eq!(
        me.git(["rev-parse", "--abbrev-ref", "feature@{upstream}"])
            .stdout_str(),
        "origin/feature\n"
    );
}
