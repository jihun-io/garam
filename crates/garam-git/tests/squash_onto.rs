use garam_git::conflict::{self, Operation};
use garam_git::log;
use garam_git::testing::TestRepo;
use garam_git::{ErrorKind, status};

fn rev(repo: &TestRepo, name: &str) -> String {
    repo.git(["rev-parse", name]).stdout_str().trim().to_owned()
}

fn subjects(repo: &TestRepo) -> Vec<String> {
    repo.git(["log", "--format=%s"])
        .stdout_str()
        .lines()
        .map(str::to_owned)
        .collect()
}

fn linear() -> (TestRepo, Vec<String>) {
    let repo = TestRepo::new();
    let mut commits = vec![];
    for name in ["base", "one", "two", "three", "four"] {
        repo.write(format!("{name}.txt"), format!("{name}\n"));
        commits.push(repo.commit_all(name));
    }
    (repo, commits)
}

fn squash(repo: &TestRepo, oids: &[String], target: &str, message: &str) {
    log::squash_onto(
        repo.git_handle(),
        repo.path(),
        oids,
        target,
        &rev(repo, "HEAD"),
        "main",
        message,
    )
    .unwrap();
}

#[test]
fn folds_nonadjacent_commits_into_an_older_target_without_squashing_the_gap() {
    let (repo, commits) = linear();
    let tree = rev(&repo, "HEAD^{tree}");
    repo.git(["branch", "keep", &commits[4]]);
    repo.git(["config", "rebase.updateRefs", "true"]);
    repo.write("untracked 한글 [1].txt", "keep me\n");
    // Caller order does not change the chronological order of patches.
    squash(
        &repo,
        &[commits[4].clone(), commits[2].clone()],
        &commits[1],
        "Combined\n\nDetails.",
    );
    assert_eq!(subjects(&repo), ["three", "Combined", "base"]);
    assert_eq!(rev(&repo, "HEAD^{tree}"), tree);
    assert_eq!(rev(&repo, "keep"), commits[4], "other branches stay put");
    assert_eq!(
        repo.git(["log", "-1", "--format=%B", "HEAD~1"])
            .stdout_str()
            .trim(),
        "Combined\n\nDetails."
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("untracked 한글 [1].txt")).unwrap(),
        "keep me\n"
    );
    assert!(!repo.path().join(".git/garam-squash-todo").exists());
}

#[test]
fn folds_an_older_commit_into_a_newer_target_and_preserves_target_author() {
    let (repo, commits) = linear();
    repo.git([
        "commit",
        "--amend",
        "--author=Target Author <target@example.com>",
        "--no-edit",
    ]);
    let target = rev(&repo, "HEAD");
    let author = repo
        .git(["log", "-1", "--format=%an|%ae|%aI"])
        .stdout_str()
        .into_owned();
    let tree = rev(&repo, "HEAD^{tree}");
    squash(&repo, &[commits[1].clone()], &target, "New message");
    assert_eq!(subjects(&repo), ["New message", "three", "two", "base"]);
    assert_eq!(rev(&repo, "HEAD^{tree}"), tree);
    assert_eq!(
        repo.git(["log", "-1", "--format=%an|%ae|%aI"]).stdout_str(),
        author
    );
}

#[test]
fn can_fold_the_root_and_preserves_unrelated_empty_commits() {
    let repo = TestRepo::new();
    repo.write("root.txt", "root\n");
    let root = repo.commit_all("root");
    repo.commit_all("empty");
    repo.write("target.txt", "target\n");
    let target = repo.commit_all("target");
    let tree = rev(&repo, "HEAD^{tree}");
    squash(&repo, &[root], &target, "Together");
    assert_eq!(subjects(&repo), ["Together", "empty"]);
    assert_eq!(rev(&repo, "HEAD^{tree}"), tree);
}

#[test]
fn can_fold_into_the_root() {
    let (repo, commits) = linear();
    let tree = rev(&repo, "HEAD^{tree}");
    squash(&repo, &[commits[3].clone()], &commits[0], "Root and three");
    assert_eq!(subjects(&repo), ["four", "two", "one", "Root and three"]);
    assert_eq!(rev(&repo, "HEAD^{tree}"), tree);
}

#[test]
fn refuses_invalid_selection_without_changing_head() {
    let (repo, commits) = linear();
    let head = rev(&repo, "HEAD");
    let cases = [
        (vec![], commits[1].clone()),
        (vec![commits[1].clone()], commits[1].clone()),
        (
            vec![commits[2].clone(), commits[2].clone()],
            commits[1].clone(),
        ),
        (vec!["f".repeat(40)], commits[1].clone()),
        (vec![commits[2].clone()], "f".repeat(40)),
    ];
    for (oids, target) in cases {
        let err = log::squash_onto(
            repo.git_handle(),
            repo.path(),
            &oids,
            &target,
            &head,
            "main",
            "message",
        )
        .unwrap_err();
        assert_eq!(err.kind(), ErrorKind::CannotSquash);
        assert_eq!(rev(&repo, "HEAD"), head);
    }
    for message in [" \n ", "bad\0message"] {
        assert_eq!(
            log::squash_onto(
                repo.git_handle(),
                repo.path(),
                &[commits[2].clone()],
                &commits[1],
                &head,
                "main",
                message
            )
            .unwrap_err()
            .kind(),
            ErrorKind::CannotSquash
        );
    }
}

#[test]
fn refuses_head_or_branch_changes_and_detached_head() {
    let (repo, commits) = linear();
    let call = |head: &str| {
        log::squash_onto(
            repo.git_handle(),
            repo.path(),
            &[commits[2].clone()],
            &commits[1],
            head,
            "main",
            "message",
        )
        .unwrap_err()
        .kind()
    };
    assert_eq!(call(&commits[3]), ErrorKind::HeadMoved);
    repo.git(["switch", "-c", "other"]);
    assert_eq!(call(&commits[4]), ErrorKind::HeadMoved);
    repo.git(["checkout", "--detach"]);
    assert_eq!(call(&commits[4]), ErrorKind::DetachedHead);
}

#[test]
fn refuses_staged_and_unstaged_changes_without_modifying_them() {
    for staged in [false, true] {
        let (repo, commits) = linear();
        repo.write("one.txt", "local work\n");
        if staged {
            repo.git(["add", "one.txt"]);
        }
        let index = rev(&repo, ":one.txt");
        let err = log::squash_onto(
            repo.git_handle(),
            repo.path(),
            &[commits[3].clone()],
            &commits[1],
            &commits[4],
            "main",
            "message",
        )
        .unwrap_err();
        assert_eq!(err.kind(), ErrorKind::UncommittedChanges);
        assert_eq!(rev(&repo, "HEAD"), commits[4]);
        assert_eq!(rev(&repo, ":one.txt"), index);
        assert_eq!(
            std::fs::read_to_string(repo.path().join("one.txt")).unwrap(),
            "local work\n"
        );
    }
}

#[test]
fn refuses_merges_after_the_target() {
    let (repo, commits) = linear();
    repo.git(["switch", "-c", "side", &commits[0]]);
    repo.write("side.txt", "side\n");
    repo.commit_all("side");
    repo.git(["switch", "main"]);
    repo.git(["merge", "--no-ff", "--no-edit", "side"]);
    let head = rev(&repo, "HEAD");
    let err = log::squash_onto(
        repo.git_handle(),
        repo.path(),
        &[commits[3].clone()],
        &commits[1],
        &head,
        "main",
        "message",
    )
    .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::CannotSquash);
    assert_eq!(rev(&repo, "HEAD"), head);
}

fn conflicting() -> (TestRepo, String, String, String) {
    let repo = TestRepo::new();
    repo.write("file.txt", "base\n");
    repo.commit_all("base");
    repo.write("target.txt", "target\n");
    let target = repo.commit_all("target");
    repo.write("file.txt", "middle\n");
    repo.commit_all("middle");
    repo.write("file.txt", "last\n");
    let dragged = repo.commit_all("last");
    let head = rev(&repo, "HEAD");
    (repo, target, dragged, head)
}

#[test]
fn conflicts_can_be_aborted_back_to_the_original_branch() {
    let (repo, target, dragged, head) = conflicting();
    let result = log::squash_onto(
        repo.git_handle(),
        repo.path(),
        &[dragged],
        &target,
        &head,
        "main",
        "Combined",
    );
    assert!(result.is_err());
    assert_eq!(
        conflict::state(repo.git_handle(), repo.path())
            .unwrap()
            .operation,
        Some(Operation::Rebase)
    );
    // Another squash must not disturb the in-progress operation.
    let current = rev(&repo, "HEAD");
    assert!(
        log::squash_onto(
            repo.git_handle(),
            repo.path(),
            std::slice::from_ref(&target),
            &current,
            &current,
            "main",
            "No"
        )
        .is_err()
    );
    conflict::abort(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(rev(&repo, "HEAD"), head);
    assert_eq!(
        std::fs::read_to_string(repo.path().join("file.txt")).unwrap(),
        "last\n"
    );
}

#[test]
fn confirmed_message_survives_conflict_continue_without_an_editor() {
    let (repo, target, dragged, head) = conflicting();
    assert!(
        log::squash_onto(
            repo.git_handle(),
            repo.path(),
            &[dragged],
            &target,
            &head,
            "main",
            "Combined\n\nConfirmed."
        )
        .is_err()
    );
    repo.write("file.txt", "resolved\n");
    repo.git(["add", "file.txt"]);
    // Replaying the intervening commit may conflict again.
    let _ = conflict::continue_operation(repo.git_handle(), repo.path());
    let state = conflict::state(repo.git_handle(), repo.path()).unwrap();
    if state.operation.is_some() {
        repo.write("file.txt", "resolved\n");
        repo.git(["add", "file.txt"]);
        if conflict::state(repo.git_handle(), repo.path())
            .unwrap()
            .empty
        {
            conflict::skip(repo.git_handle(), repo.path()).unwrap();
        } else {
            conflict::continue_operation(repo.git_handle(), repo.path()).unwrap();
        }
    }
    assert!(subjects(&repo).contains(&"Combined".to_owned()));
    assert!(
        status::status(repo.git_handle(), repo.path())
            .unwrap()
            .files
            .is_empty()
    );
    assert_eq!(
        conflict::state(repo.git_handle(), repo.path())
            .unwrap()
            .operation,
        None
    );
}
