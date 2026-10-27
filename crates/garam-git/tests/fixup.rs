use garam_git::testing::TestRepo;
use garam_git::{ErrorKind, conflict, log};

// Windows forbids asterisks in filenames; retain Unicode, spaces and literal brackets there.
const SPECIAL_PATH: &str = if cfg!(windows) {
    "한글 [x].txt"
} else {
    "한글 [x]*.txt"
};

fn rev(repo: &TestRepo, revision: &str) -> String {
    repo.git(["rev-parse", revision]).stdout_str().trim().into()
}

fn apply(repo: &TestRepo, target: &str) -> Result<String, garam_git::GitError> {
    let preview = log::fixup_preview(repo.git_handle(), repo.path())?;
    log::fixup(
        repo.git_handle(),
        repo.path(),
        target,
        &rev(repo, "HEAD"),
        "main",
        &preview.tree,
    )
}

fn contents(repo: &TestRepo, revision: &str, path: &str) -> String {
    repo.git(["show", &format!("{revision}:{path}")])
        .stdout_str()
        .into()
}

#[test]
fn adds_only_the_index_preserving_authors_messages_empty_commits_and_other_refs() {
    let repo = TestRepo::new();
    repo.write(SPECIAL_PATH, "base\n");
    repo.commit_all("base");
    repo.write(SPECIAL_PATH, "target\n");
    repo.git(["add", "--all"]);
    repo.git_handle()
        .command()
        .cwd(repo.path())
        .env("GIT_AUTHOR_NAME", "Original Author")
        .env("GIT_AUTHOR_EMAIL", "original@example.com")
        .env("GIT_AUTHOR_DATE", "1600000000 +0900")
        .args([
            "commit",
            "-m",
            "same subject\n\nOriginal body.\n\nCo-authored-by: Friend <friend@example.com>",
        ])
        .run()
        .unwrap();
    let target = rev(&repo, "HEAD");
    repo.git(["branch", "keep"]);
    repo.git(["tag", "original"]);
    let author = repo
        .git(["show", "-s", "--format=%an %ae %at %ai", &target])
        .stdout;
    let message = repo.git(["show", "-s", "--format=%B", &target]).stdout;
    repo.commit_all("same subject"); // Preserve an intentionally empty descendant.
    repo.write("later.txt", "later\n");
    repo.commit_all("fixup! same subject"); // Do not let autosquash reorder this.
    let old_head = rev(&repo, "HEAD");
    repo.write(SPECIAL_PATH, "staged\n");
    repo.git(["add", "--all"]);
    let staged_tree = log::fixup_preview(repo.git_handle(), repo.path())
        .unwrap()
        .tree;
    repo.write(SPECIAL_PATH, "unstaged\n");
    repo.write("untracked.txt", "untouched\n");
    repo.git(["config", "rebase.updateRefs", "true"]);
    repo.git(["config", "rebase.autoSquash", "true"]);
    let new_target = apply(&repo, &target).unwrap();
    assert_eq!(rev(&repo, "HEAD~2"), new_target);
    assert_eq!(rev(&repo, "HEAD^{tree}"), staged_tree);
    assert_eq!(contents(&repo, &new_target, SPECIAL_PATH), "staged\n");
    assert_eq!(
        repo.git(["show", "-s", "--format=%an %ae %at %ai", &new_target])
            .stdout,
        author
    );
    assert_eq!(
        repo.git(["show", "-s", "--format=%B", &new_target]).stdout,
        message
    );
    assert_eq!(
        repo.git(["log", "-1", "--format=%s"]).stdout_str().trim(),
        "fixup! same subject"
    );
    assert_eq!(rev(&repo, "keep"), target);
    assert_eq!(rev(&repo, "original"), target);
    assert_eq!(
        repo.git(["rev-list", "--count", "HEAD"])
            .stdout_str()
            .trim(),
        "4"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join(SPECIAL_PATH)).unwrap(),
        "unstaged\n"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("untracked.txt")).unwrap(),
        "untouched\n"
    );
    assert!(repo.git(["diff", "--cached"]).stdout.is_empty());
    assert!(
        repo.git(["reflog", "--format=%H", "main"])
            .stdout_str()
            .contains(&old_head)
    );
}

#[test]
fn supports_the_root_and_head_and_preserves_deletions_renames_and_modes() {
    let repo = TestRepo::new();
    repo.write("old.txt", "keep\n");
    repo.write("remove.txt", "remove\n");
    let root = repo.commit_all("root");
    repo.git(["mv", "old.txt", "new.txt"]);
    repo.git(["rm", "remove.txt"]);
    repo.write("script.sh", "#!/bin/sh\n");
    repo.git(["add", "--all"]);
    repo.git(["update-index", "--chmod=+x", "script.sh"]);
    let tree = log::fixup_preview(repo.git_handle(), repo.path())
        .unwrap()
        .tree;
    let rewritten = apply(&repo, &root).unwrap();
    assert_eq!(rev(&repo, "HEAD"), rewritten);
    assert_eq!(rev(&repo, "HEAD^{tree}"), tree);
    assert_eq!(
        repo.git(["rev-list", "--count", "HEAD"])
            .stdout_str()
            .trim(),
        "1"
    );
    assert!(!repo.path().join("remove.txt").exists());
    assert_eq!(contents(&repo, "HEAD", "new.txt"), "keep\n");
}

#[test]
fn refuses_stale_head_branch_and_index_without_changing_data() {
    let repo = TestRepo::new();
    let target = repo.commit_all("target");
    repo.write("file.txt", "first\n");
    repo.git(["add", "--all"]);
    let preview = log::fixup_preview(repo.git_handle(), repo.path()).unwrap();
    repo.write("file.txt", "second\n");
    repo.git(["add", "--all"]);
    assert_eq!(
        log::fixup(
            repo.git_handle(),
            repo.path(),
            &target,
            &target,
            "main",
            &preview.tree
        )
        .unwrap_err()
        .kind(),
        ErrorKind::IndexChanged
    );
    let preview = log::fixup_preview(repo.git_handle(), repo.path()).unwrap();
    repo.git(["switch", "-c", "other"]);
    assert_eq!(
        log::fixup(
            repo.git_handle(),
            repo.path(),
            &target,
            &target,
            "main",
            &preview.tree
        )
        .unwrap_err()
        .kind(),
        ErrorKind::HeadMoved
    );
    repo.git(["switch", "main"]);
    let head = repo.commit_all("new head");
    assert_eq!(
        log::fixup(
            repo.git_handle(),
            repo.path(),
            &target,
            &target,
            "main",
            &preview.tree
        )
        .unwrap_err()
        .kind(),
        ErrorKind::HeadMoved
    );
    assert_eq!(rev(&repo, "HEAD"), head);
}

#[test]
fn refuses_published_commits_merges_detached_heads_and_active_operations() {
    let repo = TestRepo::new();
    let target = repo.commit_all("target");
    repo.git(["update-ref", "refs/remotes/other/shared", &target]);
    repo.write("new.txt", "staged\n");
    repo.git(["add", "--all"]);
    assert_eq!(
        apply(&repo, &target).unwrap_err().kind(),
        ErrorKind::CannotFixup
    );
    repo.git(["update-ref", "-d", "refs/remotes/other/shared"]);
    repo.write(".git/MERGE_HEAD", format!("{target}\n"));
    assert_eq!(
        apply(&repo, &target).unwrap_err().kind(),
        ErrorKind::CannotFixup
    );
    std::fs::remove_file(repo.path().join(".git/MERGE_HEAD")).unwrap();
    repo.git(["switch", "--detach"]);
    assert_eq!(
        apply(&repo, &target).unwrap_err().kind(),
        ErrorKind::DetachedHead
    );
    repo.git(["switch", "main"]);
    repo.commit_all("main");
    repo.git(["switch", "-c", "side", &target]);
    repo.commit_all("side");
    repo.git(["switch", "main"]);
    repo.git(["merge", "--no-ff", "side", "-m", "merge"]);
    repo.write("new.txt", "extra\n");
    repo.git(["add", "--all"]);
    for oid in [&target, &rev(&repo, "HEAD")] {
        assert_eq!(
            apply(&repo, oid).unwrap_err().kind(),
            ErrorKind::CannotFixup
        );
    }
}

#[test]
fn refuses_an_empty_index_and_an_unrelated_commit() {
    let repo = TestRepo::new();
    let root = repo.commit_all("root");
    assert_eq!(
        apply(&repo, &root).unwrap_err().kind(),
        ErrorKind::CannotFixup
    );
    repo.git(["switch", "-c", "side"]);
    let side = repo.commit_all("side");
    repo.git(["switch", "main"]);
    repo.write("file.txt", "staged\n");
    repo.git(["add", "--all"]);
    assert_eq!(
        apply(&repo, &side).unwrap_err().kind(),
        ErrorKind::CannotFixup
    );
    assert_eq!(rev(&repo, "HEAD"), root);
}

fn conflicted_repo() -> (TestRepo, String, String) {
    let repo = TestRepo::new();
    repo.write("file.txt", "base\n");
    let target = repo.commit_all("target");
    repo.write("file.txt", "later\n");
    let head = repo.commit_all("later");
    repo.write("file.txt", "fixup\n");
    repo.git(["add", "--all"]);
    (repo, target, head)
}

#[test]
fn conflicts_can_abort_to_a_saved_fixup_commit_with_unstaged_changes_preserved() {
    let (repo, target, head) = conflicted_repo();
    repo.write("file.txt", "unstaged\n");
    assert_eq!(
        apply(&repo, &target).unwrap_err().kind(),
        ErrorKind::FixupIncomplete
    );
    assert_eq!(
        conflict::state(repo.git_handle(), repo.path())
            .unwrap()
            .operation,
        Some(conflict::Operation::Rebase)
    );
    conflict::abort(repo.git_handle(), repo.path()).unwrap();
    assert_eq!(rev(&repo, "HEAD^"), head);
    assert_eq!(contents(&repo, "HEAD", "file.txt"), "fixup\n");
    assert_eq!(
        std::fs::read_to_string(repo.path().join("file.txt")).unwrap(),
        "unstaged\n"
    );
    assert!(
        repo.git(["log", "-1", "--format=%s"])
            .stdout_str()
            .starts_with("fixup!")
    );
}

#[test]
fn conflicts_can_be_resolved_and_continued_through_the_existing_flow() {
    let (repo, target, _) = conflicted_repo();
    assert_eq!(
        apply(&repo, &target).unwrap_err().kind(),
        ErrorKind::FixupIncomplete
    );
    repo.write("file.txt", "resolved\n");
    conflict::mark_resolved(repo.git_handle(), repo.path(), "file.txt").unwrap();
    // Replaying the later commit may conflict again.
    let _ = conflict::continue_operation(repo.git_handle(), repo.path());
    if conflict::state(repo.git_handle(), repo.path())
        .unwrap()
        .operation
        .is_some()
    {
        repo.write("file.txt", "final\n");
        conflict::mark_resolved(repo.git_handle(), repo.path(), "file.txt").unwrap();
        conflict::continue_operation(repo.git_handle(), repo.path()).unwrap();
    }
    assert!(
        conflict::state(repo.git_handle(), repo.path())
            .unwrap()
            .operation
            .is_none()
    );
    assert_eq!(
        repo.git(["rev-list", "--count", "HEAD"])
            .stdout_str()
            .trim(),
        "2"
    );
    assert_eq!(
        repo.git(["log", "-1", "--format=%s", "HEAD~1"])
            .stdout_str()
            .trim(),
        "target"
    );
}

#[test]
fn signing_failure_keeps_the_original_head_index_and_working_files() {
    let repo = TestRepo::new();
    let target = repo.commit_all("target");
    repo.write("new.txt", "staged\n");
    repo.git(["add", "--all"]);
    let tree = log::fixup_preview(repo.git_handle(), repo.path())
        .unwrap()
        .tree;
    repo.git(["config", "commit.gpgsign", "true"]);
    repo.git(["config", "gpg.program", "garam-nonexistent-signing-program"]);
    assert!(apply(&repo, &target).is_err());
    assert_eq!(rev(&repo, "HEAD"), target);
    assert_eq!(
        log::fixup_preview(repo.git_handle(), repo.path())
            .unwrap()
            .tree,
        tree
    );
}

#[test]
fn rebase_failure_before_starting_keeps_the_saved_commit() {
    let repo = TestRepo::new();
    let target = repo.commit_all("target");
    repo.write("new.txt", "staged\n");
    repo.git(["add", "--all"]);
    // A rejected pre-rebase hook must leave the saved changes discoverable.
    let hook = repo.write(".git/hooks/pre-rebase", "#!/bin/sh\nexit 1\n");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    #[cfg(windows)]
    let _ = hook;
    assert_eq!(
        apply(&repo, &target).unwrap_err().kind(),
        ErrorKind::FixupIncomplete
    );
    assert_eq!(rev(&repo, "HEAD^"), target);
    assert_eq!(contents(&repo, "HEAD", "new.txt"), "staged\n");
}

#[test]
fn works_in_a_linked_worktree_with_spaces_quotes_and_korean_in_its_path() {
    let repo = TestRepo::new();
    repo.write("file.txt", "base\n");
    let target = repo.commit_all("base");
    let linked = repo.path().join("linked '한국 [x]'");
    repo.git([
        std::ffi::OsStr::new("worktree"),
        std::ffi::OsStr::new("add"),
        std::ffi::OsStr::new("-b"),
        std::ffi::OsStr::new("topic"),
        linked.as_os_str(),
    ]);
    std::fs::write(linked.join("file.txt"), "staged\n").unwrap();
    repo.git_handle()
        .command()
        .cwd(&linked)
        .args(["add", "--all"])
        .run()
        .unwrap();
    let preview = log::fixup_preview(repo.git_handle(), &linked).unwrap();
    let rewritten = log::fixup(
        repo.git_handle(),
        &linked,
        &target,
        &target,
        "topic",
        &preview.tree,
    )
    .unwrap();
    assert_eq!(rev(&repo, "main"), target);
    assert_eq!(rev(&repo, "topic"), rewritten);
    assert_eq!(contents(&repo, "topic", "file.txt"), "staged\n");
}

#[test]
fn rejecting_the_commit_hook_keeps_changes_staged_without_rewriting_history() {
    let repo = TestRepo::new();
    let target = repo.commit_all("base");
    repo.write("new.txt", "staged\n");
    repo.git(["add", "--all"]);
    let tree = log::fixup_preview(repo.git_handle(), repo.path())
        .unwrap()
        .tree;
    let hook = repo.write(".git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    #[cfg(windows)]
    let _ = hook;
    assert!(apply(&repo, &target).is_err());
    assert_eq!(rev(&repo, "HEAD"), target);
    assert_eq!(
        log::fixup_preview(repo.git_handle(), repo.path())
            .unwrap()
            .tree,
        tree
    );
}
