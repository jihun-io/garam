use garam_git::diff::{FileDiff, LineKind};
use garam_git::log::{self, CommitFile, RefKind};
use garam_git::status::ChangeKind;
use garam_git::testing::TestRepo;
use garam_git::{ErrorKind, status};

fn repo_with_history(count: usize) -> TestRepo {
    let repo = TestRepo::new();
    for i in 0..count {
        repo.write("counter.txt", format!("{i}\n"));
        repo.commit_all(&format!("commit {i}"));
    }
    repo
}

#[test]
fn lists_commits_newest_first_in_pages() {
    let repo = repo_with_history(5);
    let git = repo.git_handle();

    let first = log::list(git, repo.path(), 0, 2).unwrap();
    let summaries: Vec<_> = first.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, ["commit 4", "commit 3"]);
    assert_eq!(first[0].parents, [first[1].oid.clone()]);
    assert_eq!(first[0].author_name, "Garam Test");

    let last = log::list(git, repo.path(), 4, 2).unwrap();
    assert_eq!(last.len(), 1);
    assert_eq!(last[0].summary, "commit 0");
    assert!(last[0].parents.is_empty(), "root commit");

    assert!(log::list(git, repo.path(), 5, 2).unwrap().is_empty());
}

#[test]
fn empty_repository_has_no_history() {
    let repo = TestRepo::new();
    assert!(
        log::list(repo.git_handle(), repo.path(), 0, 50)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn shows_commit_details_and_changed_files() {
    let repo = TestRepo::new();
    repo.write("keep.txt", "keep\n");
    repo.write("old name.txt", "a\nb\nc\nd\ne\n");
    repo.write("remove.txt", "bye\n");
    repo.commit_all("base");

    repo.git(["mv", "old name.txt", "새 이름.txt"]);
    repo.git(["rm", "--quiet", "remove.txt"]);
    repo.write("keep.txt", "kept\n");
    repo.write("added.txt", "hi\n");
    repo.git(["add", "--all"]);
    repo.git([
        "commit",
        "--quiet",
        "-m",
        "Reorganize files",
        "-m",
        "Longer explanation.\n\nSecond paragraph.",
    ]);
    let oid = repo
        .git(["rev-parse", "HEAD"])
        .stdout_str()
        .trim()
        .to_owned();

    let detail = log::detail(repo.git_handle(), repo.path(), &oid).unwrap();
    assert_eq!(detail.commit.oid, oid);
    assert_eq!(detail.commit.summary, "Reorganize files");
    assert_eq!(detail.body, "Longer explanation.\n\nSecond paragraph.");
    assert_eq!(detail.committer_name, "Garam Test");

    let mut files: Vec<_> = detail
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.kind, f.orig_path.as_deref()))
        .collect();
    files.sort_by_key(|(path, _, _)| *path);
    assert_eq!(
        files,
        [
            ("added.txt", ChangeKind::Added, None),
            ("keep.txt", ChangeKind::Modified, None),
            ("remove.txt", ChangeKind::Deleted, None),
            ("새 이름.txt", ChangeKind::Renamed, Some("old name.txt")),
        ]
    );
}

#[test]
fn root_commit_lists_all_files_as_added() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    let oid = repo.commit_all("root");
    let detail = log::detail(repo.git_handle(), repo.path(), &oid).unwrap();
    assert_eq!(detail.files.len(), 1);
    assert_eq!(detail.files[0].kind, ChangeKind::Added);

    let diff = log::file_diff(repo.git_handle(), repo.path(), &oid, &detail.files[0]).unwrap();
    let FileDiff::Text { hunks, .. } = diff else {
        panic!("expected text diff")
    };
    assert_eq!(hunks[0].lines[0].kind, LineKind::Added);
}

#[test]
fn diffs_a_file_against_the_first_parent() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\ntwo\n");
    repo.commit_all("base");
    repo.write("a.txt", "one\n2\n");
    let oid = repo.commit_all("edit");

    let file = CommitFile {
        path: "a.txt".into(),
        orig_path: None,
        kind: ChangeKind::Modified,
    };
    let FileDiff::Text { hunks, .. } =
        log::file_diff(repo.git_handle(), repo.path(), &oid, &file).unwrap()
    else {
        panic!("expected text diff")
    };
    let changed: Vec<_> = hunks[0]
        .lines
        .iter()
        .filter(|l| l.kind != LineKind::Context)
        .map(|l| (l.kind, l.text.as_str()))
        .collect();
    assert_eq!(
        changed,
        [(LineKind::Deleted, "two"), (LineKind::Added, "2")]
    );
}

#[test]
fn rejects_revision_expressions() {
    let repo = repo_with_history(1);
    let err = log::detail(repo.git_handle(), repo.path(), "HEAD~1").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Unknown);
}

#[test]
fn reverts_a_commit() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    repo.write("a.txt", "two\n");
    let oid = repo.commit_all("change");

    log::revert(repo.git_handle(), repo.path(), &oid).unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
        "one\n"
    );
    let head = log::list(repo.git_handle(), repo.path(), 0, 1).unwrap();
    assert_eq!(head[0].summary, "Revert \"change\"");
}

#[test]
fn reverts_a_merge_commit_against_its_first_parent() {
    let repo = TestRepo::new();
    repo.write("a.txt", "base\n");
    repo.commit_all("base");
    repo.git(["switch", "--quiet", "-c", "topic"]);
    repo.write("topic.txt", "topic\n");
    repo.commit_all("topic work");
    repo.git(["switch", "--quiet", "main"]);
    repo.write("main.txt", "main\n");
    repo.commit_all("main work");
    repo.git(["merge", "--quiet", "--no-edit", "topic"]);
    let merge = repo
        .git(["rev-parse", "HEAD"])
        .stdout_str()
        .trim()
        .to_owned();

    log::revert(repo.git_handle(), repo.path(), &merge).unwrap();
    assert!(!repo.path().join("topic.txt").exists());
    assert!(repo.path().join("main.txt").exists());
}

#[test]
fn revert_conflicts_are_reported() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    repo.write("a.txt", "two\n");
    let oid = repo.commit_all("change");
    repo.write("a.txt", "three\n");
    repo.commit_all("later change");

    let err = log::revert(repo.git_handle(), repo.path(), &oid).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::RevertConflict, "{err}");
    let conflicted = status::status(repo.git_handle(), repo.path())
        .unwrap()
        .files
        .iter()
        .any(|f| f.is_conflicted());
    assert!(conflicted);
}

fn head_of(repo: &TestRepo) -> String {
    repo.git(["rev-parse", "HEAD"])
        .stdout_str()
        .trim()
        .to_owned()
}

#[test]
fn marks_refs_unpushed_and_incoming_commits() {
    let remote = TestRepo::bare();
    let local = TestRepo::clone_of(&remote);
    local.write("a.txt", "a\n");
    let base = local.commit_all("base");
    local.git(["push", "--quiet", "origin", "main"]);
    local.git(["tag", "-a", "-m", "release", "v1", "HEAD"]);

    // Someone else pushes; we fetch but don't pull.
    let other = TestRepo::clone_of(&remote);
    other.write("b.txt", "b\n");
    other.commit_all("from upstream");
    other.git(["push", "--quiet", "origin", "main"]);
    local.git(["fetch", "--quiet"]);

    local.write("c.txt", "c\n");
    local.commit_all("local only");
    let head = head_of(&local);

    let markers = log::markers(local.git_handle(), local.path()).unwrap();
    assert_eq!(markers.unpushed, std::slice::from_ref(&head));
    let incoming: Vec<_> = markers
        .incoming
        .iter()
        .map(|c| c.summary.as_str())
        .collect();
    assert_eq!(incoming, ["from upstream"]);

    let label = |name: &str| markers.refs.iter().find(|r| r.name == name).unwrap();
    assert_eq!(label("main").kind, RefKind::Branch);
    assert_eq!(label("main").oid, head);
    assert!(label("main").current);
    assert_eq!(label("origin/main").kind, RefKind::Remote);
    assert_eq!(label("origin/main").oid, markers.incoming[0].oid);
    assert_eq!(label("v1").kind, RefKind::Tag);
    assert_eq!(
        label("v1").oid,
        base,
        "annotated tag is peeled to its commit"
    );
    assert!(
        markers
            .refs
            .iter()
            .all(|r| r.name != "origin/HEAD" && r.name != "origin"),
        "symbolic refs are skipped"
    );
}

#[test]
fn branch_without_upstream_marks_commits_missing_from_remotes() {
    let remote = TestRepo::bare();
    let local = TestRepo::clone_of(&remote);
    local.write("a.txt", "a\n");
    local.commit_all("base");
    local.git(["push", "--quiet", "origin", "main"]);
    local.git(["switch", "--quiet", "-c", "feature"]);
    local.write("b.txt", "b\n");
    local.commit_all("feature work");

    let markers = log::markers(local.git_handle(), local.path()).unwrap();
    assert_eq!(markers.unpushed, [head_of(&local)]);
    assert!(markers.incoming.is_empty());
}

#[test]
fn repository_without_remote_marks_nothing() {
    let repo = repo_with_history(2);
    let markers = log::markers(repo.git_handle(), repo.path()).unwrap();
    assert!(markers.unpushed.is_empty());
    assert!(markers.incoming.is_empty());
    assert_eq!(markers.refs.len(), 1);
    assert!(markers.refs[0].current);
}

#[test]
fn detached_head_gets_its_own_label() {
    let repo = repo_with_history(2);
    repo.git(["switch", "--quiet", "--detach", "HEAD~1"]);
    let markers = log::markers(repo.git_handle(), repo.path()).unwrap();
    let head = &markers.refs[0];
    assert_eq!(head.kind, RefKind::Head);
    assert_eq!(head.oid, head_of(&repo));
    assert!(head.current);
    assert!(markers.refs.iter().filter(|r| r.current).count() == 1);
}

#[test]
fn unborn_branch_has_no_markers() {
    let repo = TestRepo::new();
    let markers = log::markers(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(markers, log::HistoryMarkers::default());
}
