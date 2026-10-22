use garam_git::compare::{self, CompareMode};
use garam_git::diff::{FileDiff, LineKind};
use garam_git::testing::TestRepo;

fn rev(repo: &TestRepo, rev: &str) -> String {
    repo.git(["rev-parse", rev]).stdout_str().trim().to_owned()
}

/// base → main: "main work" (m.txt); feature (from base): two commits.
fn diverged() -> TestRepo {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    repo.git(["switch", "--quiet", "-c", "feature"]);
    repo.write("a.txt", "one\nfeature\n");
    repo.commit_all("feature 1");
    repo.write("f.txt", "f\n");
    repo.commit_all("feature 2");
    repo.git(["switch", "--quiet", "main"]);
    repo.write("m.txt", "m\n");
    repo.commit_all("main work");
    repo
}

fn paths(c: &compare::Comparison) -> Vec<&str> {
    let mut paths: Vec<_> = c.files.iter().map(|f| f.path.as_str()).collect();
    paths.sort();
    paths
}

#[test]
fn three_dot_shows_what_the_branch_added_since_it_split() {
    let repo = diverged();
    let c = compare::compare(
        repo.git_handle(),
        repo.path(),
        "refs/heads/main",
        "refs/heads/feature",
        CompareMode::ThreeDot,
    )
    .unwrap();
    assert_eq!(c.base, rev(&repo, "main"));
    assert_eq!(c.target, rev(&repo, "feature"));
    assert_eq!(c.from, rev(&repo, "main~1"), "the merge base");
    assert_eq!((c.ahead, c.behind), (2, 1));
    let summaries: Vec<_> = c.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, ["feature 2", "feature 1"]);
    // main's own change isn't part of it.
    assert_eq!(paths(&c), ["a.txt", "f.txt"]);

    let a = c.files.iter().find(|f| f.path == "a.txt").unwrap();
    let FileDiff::Text { hunks, .. } =
        compare::file_diff(repo.git_handle(), repo.path(), &c.from, &c.target, a, false).unwrap()
    else {
        panic!("text diff");
    };
    let added: Vec<_> = hunks
        .iter()
        .flat_map(|h| &h.lines)
        .filter(|l| l.kind == LineKind::Added)
        .map(|l| l.text.as_str())
        .collect();
    assert_eq!(added, ["feature"]);
}

#[test]
fn two_dot_compares_the_commits_themselves() {
    let repo = diverged();
    let main = rev(&repo, "main");
    let feature = rev(&repo, "feature");
    let c = compare::compare(
        repo.git_handle(),
        repo.path(),
        &main,
        &feature,
        CompareMode::TwoDot,
    )
    .unwrap();
    assert_eq!(c.from, main);
    // m.txt exists on main but not on feature: it shows as deleted.
    assert_eq!(paths(&c), ["a.txt", "f.txt", "m.txt"]);
}

#[test]
fn rejects_anything_but_commit_ids_and_full_refs() {
    let repo = diverged();
    for bad in ["main", "HEAD~1", "--output=x", "refs/heads/missing", ""] {
        assert!(
            compare::compare(
                repo.git_handle(),
                repo.path(),
                bad,
                "refs/heads/main",
                CompareMode::TwoDot
            )
            .is_err(),
            "{bad:?}"
        );
    }
}

#[test]
fn finds_commits_lost_to_a_reset_and_a_deleted_branch() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("base");
    repo.write("a.txt", "b\n");
    repo.commit_all("lost 1");
    repo.write("a.txt", "c\n");
    let lost_tip = repo.commit_all("lost 2");
    repo.git(["reset", "--quiet", "--hard", "HEAD~2"]);

    repo.git(["switch", "--quiet", "-c", "doomed"]);
    repo.write("d.txt", "d\n");
    let doomed = repo.commit_all("doomed work");
    repo.git(["switch", "--quiet", "main"]);
    repo.git(["branch", "--quiet", "-D", "doomed"]);

    let lost = compare::lost_commits(repo.git_handle(), repo.path()).unwrap();
    let oids: Vec<_> = lost.iter().map(|l| l.commit.oid.as_str()).collect();
    // Only the newest of each lost line; "lost 1" comes back with "lost 2".
    assert_eq!(oids, [doomed.as_str(), lost_tip.as_str()]);
    assert_eq!(lost[1].commit.summary, "lost 2");
    assert!(lost[1].action.starts_with("commit"), "{}", lost[1].action);
    assert!(lost[0].visited_at > 0);

    // Once a branch holds it, it isn't lost.
    repo.git(["branch", "rescued", &lost_tip]);
    let lost = compare::lost_commits(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(lost.len(), 1);
    assert_eq!(lost[0].commit.oid, doomed);
}

#[test]
fn nothing_is_lost_in_a_new_repository() {
    let repo = TestRepo::new();
    assert!(
        compare::lost_commits(repo.git_handle(), repo.path())
            .unwrap()
            .is_empty()
    );
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    assert!(
        compare::lost_commits(repo.git_handle(), repo.path())
            .unwrap()
            .is_empty()
    );
}
