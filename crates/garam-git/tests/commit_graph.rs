use garam_git::commit_graph;
use garam_git::testing::TestRepo;

#[test]
fn writes_a_missing_commit_graph_once() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    let git = repo.git_handle();
    assert!(!commit_graph::exists(git, repo.path()).unwrap());

    assert!(commit_graph::ensure(git, repo.path()).unwrap());
    assert!(commit_graph::exists(git, repo.path()).unwrap());
    assert!(repo.path().join(".git/objects/info/commit-graph").is_file());
    repo.git(["commit-graph", "verify"]);

    assert!(
        !commit_graph::ensure(git, repo.path()).unwrap(),
        "already there"
    );
}

#[test]
fn keeps_a_split_commit_graph_chain() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    repo.git(["commit-graph", "write", "--reachable", "--split"]);
    let git = repo.git_handle();

    assert!(commit_graph::exists(git, repo.path()).unwrap());
    assert!(!commit_graph::ensure(git, repo.path()).unwrap());
    assert!(!repo.path().join(".git/objects/info/commit-graph").exists());
}

#[test]
fn respects_commit_graph_turned_off() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    repo.git(["config", "core.commitGraph", "false"]);

    assert!(!commit_graph::ensure(repo.git_handle(), repo.path()).unwrap());
    assert!(!commit_graph::exists(repo.git_handle(), repo.path()).unwrap());
}

#[test]
fn does_nothing_harmful_without_commits() {
    let repo = TestRepo::new();
    commit_graph::ensure(repo.git_handle(), repo.path()).unwrap();
}

#[test]
fn finds_the_commit_graph_from_a_worktree() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    let worktree = TestRepo::plain_dir();
    let dest = worktree.path().join("wt");
    repo.git(["worktree", "add", "-q", dest.to_str().unwrap(), "-b", "wt"]);

    assert!(commit_graph::ensure(repo.git_handle(), &dest).unwrap());
    assert!(repo.path().join(".git/objects/info/commit-graph").is_file());
    assert!(commit_graph::exists(repo.git_handle(), repo.path()).unwrap());
}
