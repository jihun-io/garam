use garam_git::commit_graph;
use garam_git::testing::TestRepo;

#[test]
fn writes_a_missing_commit_graph() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    let git = repo.git_handle();
    assert!(!commit_graph::exists(git, repo.path()).unwrap());

    assert!(commit_graph::update(git, repo.path()).unwrap());
    assert!(commit_graph::exists(git, repo.path()).unwrap());
    assert!(repo.path().join(".git/objects/info/commit-graph").is_file());
    repo.git(["commit-graph", "verify"]);

    assert!(
        !commit_graph::update(git, repo.path()).unwrap(),
        "already there"
    );
    assert!(
        repo.path().join(".git/objects/info/commit-graph").is_file(),
        "left alone when nothing is new"
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
    assert!(!commit_graph::update(git, repo.path()).unwrap());
    assert!(!repo.path().join(".git/objects/info/commit-graph").exists());
}

#[test]
fn respects_commit_graph_turned_off() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    repo.git(["config", "core.commitGraph", "false"]);

    assert!(!commit_graph::update(repo.git_handle(), repo.path()).unwrap());
    assert!(!commit_graph::exists(repo.git_handle(), repo.path()).unwrap());
}

#[test]
fn does_nothing_harmful_without_commits() {
    let repo = TestRepo::new();
    commit_graph::update(repo.git_handle(), repo.path()).unwrap();
}

#[test]
fn finds_the_commit_graph_from_a_worktree() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    let worktree = TestRepo::plain_dir();
    let dest = worktree.path().join("wt");
    repo.git(["worktree", "add", "-q", dest.to_str().unwrap(), "-b", "wt"]);

    assert!(commit_graph::update(repo.git_handle(), &dest).unwrap());
    assert!(repo.path().join(".git/objects/info/commit-graph").is_file());
    assert!(commit_graph::exists(repo.git_handle(), repo.path()).unwrap());
}

/// How many commits the commit-graph holds, over every layer of a chain.
fn graph_commits(repo: &TestRepo) -> usize {
    let info = repo.path().join(".git/objects/info");
    let mut files = vec![info.join("commit-graph")];
    if let Ok(chain) = std::fs::read_to_string(info.join("commit-graphs/commit-graph-chain")) {
        files.extend(
            chain
                .lines()
                .map(|hash| info.join(format!("commit-graphs/graph-{hash}.graph"))),
        );
    }
    files
        .iter()
        .filter_map(|f| std::fs::read(f).ok())
        .map(|bytes| commit_count(&bytes))
        .sum()
}

/// The commit count of one commit-graph file: the OID Fanout chunk's last
/// entry (format: header, chunk table, then chunks).
fn commit_count(bytes: &[u8]) -> usize {
    let chunks = usize::from(bytes[6]);
    for i in 0..chunks {
        let entry = &bytes[8 + i * 12..8 + i * 12 + 12];
        if &entry[..4] == b"OIDF" {
            let offset = u64::from_be_bytes(entry[4..12].try_into().unwrap()) as usize;
            let last = &bytes[offset + 255 * 4..offset + 256 * 4];
            return u32::from_be_bytes(last.try_into().unwrap()) as usize;
        }
    }
    0
}

#[test]
fn adds_new_commits_to_an_existing_commit_graph() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    let git = repo.git_handle();
    commit_graph::update(git, repo.path()).unwrap();
    assert_eq!(graph_commits(&repo), 1);

    repo.write("a.txt", "b\n");
    repo.commit_all("second");
    repo.write("a.txt", "c\n");
    repo.commit_all("third");
    assert!(
        !commit_graph::update(git, repo.path()).unwrap(),
        "not from scratch"
    );
    assert_eq!(graph_commits(&repo), 3);
    repo.git(["commit-graph", "verify"]);
}

#[test]
fn appending_needs_an_existing_commit_graph() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    commit_graph::append(repo.git_handle(), repo.path()).unwrap();
    assert!(!commit_graph::exists(repo.git_handle(), repo.path()).unwrap());
}

#[test]
fn fetching_adds_the_fetched_commits() {
    let origin = TestRepo::new();
    origin.write("a.txt", "a\n");
    origin.commit_all("first");
    let clone = TestRepo::clone_of(&origin);
    commit_graph::update(clone.git_handle(), clone.path()).unwrap();
    assert_eq!(graph_commits(&clone), 1);

    origin.write("a.txt", "b\n");
    origin.commit_all("second");
    garam_git::remote::fetch(
        clone.git_handle(),
        clone.path(),
        "origin",
        &garam_git::CancelToken::new(),
        |_| {},
    )
    .unwrap();
    assert_eq!(graph_commits(&clone), 2);
}

#[test]
fn adds_changed_path_filters_once() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    repo.write("b.txt", "b\n");
    repo.commit_all("second");
    let git = repo.git_handle();
    commit_graph::update(git, repo.path()).unwrap();
    assert!(!commit_graph::has_changed_paths(git, repo.path()).unwrap());

    assert!(commit_graph::add_changed_paths(git, repo.path()).unwrap());
    assert!(commit_graph::has_changed_paths(git, repo.path()).unwrap());
    assert_eq!(graph_commits(&repo), 2);
    repo.git(["commit-graph", "verify"]);
    assert!(
        !commit_graph::add_changed_paths(git, repo.path()).unwrap(),
        "already there"
    );

    let history = repo.git(["log", "--format=%s", "--", "a.txt"]);
    assert_eq!(history.stdout_str().trim(), "first");
}

#[test]
fn layers_added_later_keep_changed_path_filters() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    let git = repo.git_handle();
    commit_graph::add_changed_paths(git, repo.path()).unwrap();

    repo.write("a.txt", "b\n");
    repo.commit_all("second");
    commit_graph::update(git, repo.path()).unwrap();
    assert_eq!(graph_commits(&repo), 2);
    assert!(commit_graph::has_changed_paths(git, repo.path()).unwrap());
}

#[test]
fn changed_path_filters_respect_commit_graph_turned_off() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("first");
    repo.git(["config", "core.commitGraph", "false"]);
    assert!(!commit_graph::add_changed_paths(repo.git_handle(), repo.path()).unwrap());
    assert!(!commit_graph::exists(repo.git_handle(), repo.path()).unwrap());
}
