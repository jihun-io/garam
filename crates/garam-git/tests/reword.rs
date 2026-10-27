use garam_git::testing::TestRepo;
use garam_git::{ErrorKind, log};

fn rev(repo: &TestRepo, revision: &str) -> String {
    repo.git(["rev-parse", revision]).stdout_str().trim().into()
}

fn message(repo: &TestRepo, revision: &str) -> String {
    repo.git(["log", "-1", "--format=%B", revision])
        .stdout_str()
        .into()
}

#[test]
fn rewords_an_older_commit_preserving_trees_authors_empty_commits_and_trailers() {
    let repo = TestRepo::new();
    repo.write("a.txt", "base\n");
    repo.commit_all("base");
    repo.write("a.txt", "work\n");
    repo.git(["add", "a.txt"]);
    repo.git_handle()
        .command()
        .cwd(repo.path())
        .env("GIT_AUTHOR_NAME", "Original Author")
        .env("GIT_AUTHOR_EMAIL", "original@example.com")
        .env("GIT_AUTHOR_DATE", "1600000000 +0900")
        .args([
            "commit",
            "-m",
            "old message\n\nCo-authored-by: Teammate <team@example.com>",
        ])
        .run()
        .unwrap();
    let target = rev(&repo, "HEAD");
    repo.git(["branch", "keep-original"]);
    repo.git(["tag", "keep-tag"]);
    let empty = repo
        .commit_all("empty\n\nKeep this body.\n\nCo-authored-by: Someone <someone@example.com>");
    repo.write("later.txt", "later\n");
    let head = repo.commit_all("later message");
    let old_author = repo
        .git(["show", "-s", "--format=%an %ae %at %ai", &target])
        .stdout;
    let trees = [&head, &empty, &target].map(|oid| rev(&repo, &format!("{oid}^{{tree}}")));
    let new_target = log::reword(
        repo.git_handle(),
        repo.path(),
        &target,
        &head,
        "main",
        "메시지 수정\n\n새 설명.\n\nCo-authored-by: Teammate <team@example.com>",
    )
    .unwrap();
    assert_eq!(rev(&repo, "HEAD~2"), new_target);
    assert_eq!(
        repo.git(["show", "-s", "--format=%an %ae %at %ai", &new_target])
            .stdout,
        old_author
    );
    assert_eq!(
        ["HEAD", "HEAD~1", "HEAD~2"].map(|oid| rev(&repo, &format!("{oid}^{{tree}}"))),
        trees
    );
    assert_eq!(message(&repo, "HEAD"), message(&repo, &head));
    assert_eq!(message(&repo, "HEAD~1"), message(&repo, &empty));
    assert!(message(&repo, &new_target).contains("Co-authored-by: Teammate"));
    assert_eq!(rev(&repo, "keep-original"), target);
    assert_eq!(rev(&repo, "keep-tag"), target);
    assert_eq!(
        repo.git(["rev-list", "--count", "HEAD"])
            .stdout_str()
            .trim(),
        "4"
    );
    assert!(
        repo.git(["reflog", "show", "--format=%H", "main"])
            .stdout_str()
            .contains(&head)
    );
}

#[test]
fn rewords_the_root_without_touching_staged_unstaged_or_untracked_files() {
    let repo = TestRepo::new();
    repo.write("a.txt", "committed\n");
    let root = repo.commit_all("first");
    repo.write("a.txt", "staged\n");
    repo.git(["add", "a.txt"]);
    repo.write("a.txt", "unstaged\n");
    repo.write("new.txt", "untracked\n");
    let status = repo.git(["status", "--porcelain=v1", "-z"]).stdout;
    let index = std::fs::read(repo.path().join(".git/index")).unwrap();
    let new_root = log::reword(
        repo.git_handle(),
        repo.path(),
        &root,
        &root,
        "main",
        "renamed root",
    )
    .unwrap();
    assert_ne!(new_root, root);
    assert_eq!(
        rev(&repo, "HEAD^{tree}"),
        rev(&repo, &format!("{root}^{{tree}}"))
    );
    assert_eq!(
        std::fs::read(repo.path().join(".git/index")).unwrap(),
        index
    );
    assert_eq!(repo.git(["status", "--porcelain=v1", "-z"]).stdout, status);
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
        "unstaged\n"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("new.txt")).unwrap(),
        "untracked\n"
    );
    assert_eq!(
        repo.git(["rev-list", "--count", "HEAD"])
            .stdout_str()
            .trim(),
        "1"
    );
}

#[test]
fn refuses_commits_reachable_from_any_remote_branch_even_without_an_upstream() {
    let repo = TestRepo::new();
    let published = repo.commit_all("published");
    repo.git(["update-ref", "refs/remotes/other/shared", &published]);
    let head = repo.commit_all("local");
    let error = log::reword(
        repo.git_handle(),
        repo.path(),
        &published,
        &head,
        "main",
        "changed",
    )
    .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::CannotReword);
    assert_eq!(rev(&repo, "HEAD"), head);
    log::reword(
        repo.git_handle(),
        repo.path(),
        &head,
        &head,
        "main",
        "local changed",
    )
    .unwrap();
}

#[test]
fn refuses_a_stale_head_and_detached_head() {
    let repo = TestRepo::new();
    let old = repo.commit_all("old");
    let head = repo.commit_all("head");
    assert_eq!(
        log::reword(
            repo.git_handle(),
            repo.path(),
            &old,
            &old,
            "main",
            "changed"
        )
        .unwrap_err()
        .kind(),
        ErrorKind::HeadMoved
    );
    repo.git(["switch", "-c", "other"]);
    assert_eq!(
        log::reword(
            repo.git_handle(),
            repo.path(),
            &old,
            &head,
            "main",
            "changed"
        )
        .unwrap_err()
        .kind(),
        ErrorKind::HeadMoved
    );
    repo.git(["switch", "--detach", &head]);
    assert_eq!(
        log::reword(
            repo.git_handle(),
            repo.path(),
            &old,
            &head,
            "main",
            "changed"
        )
        .unwrap_err()
        .kind(),
        ErrorKind::DetachedHead
    );
    assert_eq!(rev(&repo, "HEAD"), head);
}

#[test]
fn refuses_other_branches_merges_and_commits_before_a_merge() {
    let repo = TestRepo::new();
    let base = repo.commit_all("base");
    repo.git(["switch", "-c", "side"]);
    repo.write("side.txt", "side");
    let side = repo.commit_all("side");
    repo.git(["switch", "main"]);
    let head = repo.commit_all("main");
    assert_eq!(
        log::reword(
            repo.git_handle(),
            repo.path(),
            &side,
            &head,
            "main",
            "changed"
        )
        .unwrap_err()
        .kind(),
        ErrorKind::CannotReword
    );
    repo.git(["merge", "--no-ff", "side", "-m", "merge"]);
    let merge = rev(&repo, "HEAD");
    for target in [&merge, &base] {
        assert_eq!(
            log::reword(
                repo.git_handle(),
                repo.path(),
                target,
                &merge,
                "main",
                "changed"
            )
            .unwrap_err()
            .kind(),
            ErrorKind::CannotReword
        );
    }
    assert_eq!(rev(&repo, "HEAD"), merge);
}

#[test]
fn refuses_in_progress_operations_and_invalid_messages() {
    let repo = TestRepo::new();
    let head = repo.commit_all("head");
    for message in ["", " \n ", "bad\0message"] {
        assert_eq!(
            log::reword(
                repo.git_handle(),
                repo.path(),
                &head,
                &head,
                "main",
                message
            )
            .unwrap_err()
            .kind(),
            ErrorKind::CannotReword
        );
    }
    repo.write(".git/MERGE_HEAD", format!("{head}\n"));
    assert_eq!(
        log::reword(
            repo.git_handle(),
            repo.path(),
            &head,
            &head,
            "main",
            "changed"
        )
        .unwrap_err()
        .kind(),
        ErrorKind::CannotReword
    );
    assert_eq!(rev(&repo, "HEAD"), head);
}

#[test]
fn a_signing_failure_leaves_the_branch_and_working_tree_unchanged() {
    let repo = TestRepo::new();
    repo.write("a.txt", "original");
    let head = repo.commit_all("head");
    repo.git(["config", "commit.gpgsign", "true"]);
    repo.git(["config", "gpg.program", "garam-nonexistent-signing-program"]);
    assert!(
        log::reword(
            repo.git_handle(),
            repo.path(),
            &head,
            &head,
            "main",
            "changed"
        )
        .is_err()
    );
    assert_eq!(rev(&repo, "HEAD"), head);
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
        "original"
    );
}
