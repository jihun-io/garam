use garam_git::remote::{self, PullOutcome};
use garam_git::testing::TestRepo;
use garam_git::{CancelToken, ErrorKind, status, tag};

/// A bare remote with one commit on `main`, plus a clone of it.
struct Setup {
    remote: TestRepo,
    local: TestRepo,
}

impl Setup {
    fn new() -> Self {
        let remote = TestRepo::bare();
        let seed = TestRepo::clone_of(&remote);
        seed.write("file.txt", "base\n");
        seed.commit_all("initial");
        seed.git(["push", "--quiet", "origin", "main"]);
        let local = TestRepo::clone_of(&remote);
        Self { remote, local }
    }

    /// Pushes a new commit to the remote from another clone.
    fn commit_upstream(&self, path: &str, contents: &str) {
        let other = TestRepo::clone_of(&self.remote);
        other.write(path, contents);
        other.commit_all(&format!("upstream {path}"));
        other.git(["push", "--quiet", "origin", "HEAD"]);
    }
}

fn ahead_behind(repo: &TestRepo) -> (u32, u32) {
    let branch = status::status(repo.git_handle(), repo.path())
        .unwrap()
        .branch;
    (branch.ahead, branch.behind)
}

fn remote_head(remote: &TestRepo, branch: &str) -> String {
    remote
        .git(["rev-parse", branch])
        .stdout_str()
        .trim()
        .to_owned()
}

fn head(repo: &TestRepo) -> String {
    repo.git(["rev-parse", "HEAD"])
        .stdout_str()
        .trim()
        .to_owned()
}

fn fetch(repo: &TestRepo) -> Result<(), garam_git::GitError> {
    remote::fetch(
        repo.git_handle(),
        repo.path(),
        "origin",
        &CancelToken::new(),
        |_| {},
    )
}

fn pull(repo: &TestRepo) -> Result<PullOutcome, garam_git::GitError> {
    remote::pull(
        repo.git_handle(),
        repo.path(),
        false,
        &CancelToken::new(),
        |_| {},
    )
}

fn push(repo: &TestRepo) -> Result<(), garam_git::GitError> {
    remote::push(repo.git_handle(), repo.path(), &CancelToken::new(), |_| {})
}

#[test]
fn reports_remotes_default_and_last_fetch() {
    let s = Setup::new();
    s.local.git([
        "remote",
        "add",
        "my.fork",
        "https://example.invalid/fork.git",
    ]);

    let info = remote::info(s.local.git_handle(), s.local.path()).unwrap();
    let names: Vec<_> = info.remotes.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, ["origin", "my.fork"]);
    assert_eq!(info.default_remote.as_deref(), Some("origin"));
    // A clone doesn't write FETCH_HEAD.
    assert_eq!(info.last_fetched_at, None);

    fetch(&s.local).unwrap();
    let info = remote::info(s.local.git_handle(), s.local.path()).unwrap();
    assert!(info.last_fetched_at.is_some());
}

#[test]
fn reports_no_remotes() {
    let repo = TestRepo::new();
    let info = remote::info(repo.git_handle(), repo.path()).unwrap();
    assert!(info.remotes.is_empty());
    assert_eq!(info.default_remote, None);
}

#[test]
fn fetch_counts_incoming_commits() {
    let s = Setup::new();
    s.commit_upstream("new.txt", "new\n");
    assert_eq!(ahead_behind(&s.local), (0, 0));
    fetch(&s.local).unwrap();
    assert_eq!(ahead_behind(&s.local), (0, 1));
}

#[test]
fn fetch_prunes_deleted_remote_branches() {
    let s = Setup::new();
    s.local.git(["push", "--quiet", "origin", "main:temp"]);
    fetch(&s.local).unwrap();
    s.remote.git(["branch", "-D", "temp"]);
    fetch(&s.local).unwrap();
    let refs = s
        .local
        .git(["branch", "--remotes"])
        .stdout_str()
        .into_owned();
    assert!(!refs.contains("origin/temp"), "{refs}");
}

#[test]
fn pull_fast_forwards() {
    let s = Setup::new();
    s.commit_upstream("new.txt", "new\n");
    assert_eq!(pull(&s.local).unwrap(), PullOutcome::Updated);
    assert_eq!(head(&s.local), remote_head(&s.remote, "main"));
    assert!(s.local.path().join("new.txt").exists());
}

#[test]
fn pull_when_up_to_date() {
    let s = Setup::new();
    assert_eq!(pull(&s.local).unwrap(), PullOutcome::UpToDate);
}

#[test]
fn pull_merges_diverged_branches_by_default() {
    let s = Setup::new();
    s.commit_upstream("theirs.txt", "theirs\n");
    s.local.write("mine.txt", "mine\n");
    s.local.commit_all("local work");

    assert_eq!(pull(&s.local).unwrap(), PullOutcome::Updated);
    let parents = s.local.git(["rev-list", "--parents", "-n1", "HEAD"]);
    assert_eq!(parents.stdout_str().split_whitespace().count(), 3, "merge");
    assert_eq!(ahead_behind(&s.local), (2, 0));
}

#[test]
fn pull_rebases_when_configured() {
    let s = Setup::new();
    s.local.git(["config", "pull.rebase", "true"]);
    s.commit_upstream("theirs.txt", "theirs\n");
    s.local.write("mine.txt", "mine\n");
    s.local.commit_all("local work");

    pull(&s.local).unwrap();
    let parents = s.local.git(["rev-list", "--parents", "-n1", "HEAD"]);
    assert_eq!(parents.stdout_str().split_whitespace().count(), 2, "linear");
    assert_eq!(ahead_behind(&s.local), (1, 0));
}

#[test]
fn pull_respects_fast_forward_only() {
    let s = Setup::new();
    s.local.git(["config", "pull.ff", "only"]);
    s.commit_upstream("theirs.txt", "theirs\n");
    s.local.write("mine.txt", "mine\n");
    s.local.commit_all("local work");

    let err = pull(&s.local).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::CannotFastForward, "{err}");
}

#[test]
fn pull_reports_conflicts() {
    let s = Setup::new();
    s.commit_upstream("file.txt", "theirs\n");
    s.local.write("file.txt", "mine\n");
    s.local.commit_all("local edit");

    let err = pull(&s.local).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::MergeConflict, "{err}");
}

#[test]
fn pull_reports_deleted_upstream() {
    let s = Setup::new();
    s.local.git(["switch", "--quiet", "-c", "topic"]);
    s.local.git(["push", "--quiet", "-u", "origin", "topic"]);
    s.remote.git(["branch", "-D", "topic"]);

    let err = pull(&s.local).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::RemoteBranchNotFound, "{err}");
}

#[test]
fn pull_and_push_need_an_upstream() {
    let s = Setup::new();
    s.local.git(["switch", "--quiet", "-c", "topic"]);
    assert_eq!(pull(&s.local).unwrap_err().kind(), ErrorKind::NoUpstream);
    assert_eq!(push(&s.local).unwrap_err().kind(), ErrorKind::NoUpstream);
}

#[test]
fn push_and_pull_need_a_branch() {
    let s = Setup::new();
    s.local.git(["switch", "--quiet", "--detach"]);
    assert_eq!(pull(&s.local).unwrap_err().kind(), ErrorKind::DetachedHead);
    assert_eq!(push(&s.local).unwrap_err().kind(), ErrorKind::DetachedHead);
}

#[test]
fn push_sends_local_commits() {
    let s = Setup::new();
    s.local.write("mine.txt", "mine\n");
    let commit = s.local.commit_all("local work");
    assert_eq!(ahead_behind(&s.local), (1, 0));

    push(&s.local).unwrap();
    assert_eq!(remote_head(&s.remote, "main"), commit);
    assert_eq!(ahead_behind(&s.local), (0, 0));
}

#[test]
fn push_is_rejected_when_remote_has_new_commits() {
    let s = Setup::new();
    s.commit_upstream("theirs.txt", "theirs\n");
    s.local.write("mine.txt", "mine\n");
    s.local.commit_all("local work");

    let err = push(&s.local).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NonFastForward, "{err}");
}

fn tag_on(repo: &TestRepo, name: &str) -> Option<String> {
    let output = repo.git(["tag", "--list", "--format=%(objectname)", name]);
    let oid = output.stdout_str().trim().to_owned();
    (!oid.is_empty()).then_some(oid)
}

#[test]
fn push_carries_tags_made_in_the_app() {
    let s = Setup::new();
    let git = s.local.git_handle();
    s.local.write("mine.txt", "mine\n");
    let commit = s.local.commit_all("local work");
    tag::create(git, s.local.path(), "v1.0", &commit, None).unwrap();
    s.local.git(["tag", "outside", &commit]);

    push(&s.local).unwrap();
    assert_eq!(remote_head(&s.remote, "main"), commit);
    assert_eq!(tag_on(&s.remote, "v1.0").as_deref(), Some(commit.as_str()));
    assert_eq!(tag_on(&s.remote, "outside"), None, "only the app's tags go");
    assert!(tag::unpushed(git, s.local.path()).unwrap().is_empty());
}

#[test]
fn push_sends_tags_when_the_branch_is_already_pushed() {
    let s = Setup::new();
    let git = s.local.git_handle();
    let commit = head(&s.local);
    tag::create(git, s.local.path(), "v1.0", &commit, Some("release")).unwrap();
    assert_eq!(ahead_behind(&s.local), (0, 0));

    push(&s.local).unwrap();
    assert!(tag_on(&s.remote, "v1.0").is_some());
    assert!(tag::unpushed(git, s.local.path()).unwrap().is_empty());
}

#[test]
fn push_keeps_tags_the_remote_refuses() {
    let s = Setup::new();
    let git = s.local.git_handle();
    // Someone pushed a v1.0 tag on a commit only they have.
    let other = TestRepo::clone_of(&s.remote);
    other.write("theirs.txt", "theirs\n");
    other.commit_all("their work");
    other.git(["tag", "v1.0"]);
    other.git(["push", "--quiet", "origin", "v1.0"]);

    let commit = head(&s.local);
    tag::create(git, s.local.path(), "v1.0", &commit, None).unwrap();
    let err = push(&s.local).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::RemoteTagExists, "{err}");
    assert_eq!(tag::unpushed(git, s.local.path()).unwrap(), ["v1.0"]);
}

#[test]
fn deletes_tags_on_the_remote() {
    let s = Setup::new();
    let git = s.local.git_handle();
    let commit = head(&s.local);
    tag::create(git, s.local.path(), "v1.0", &commit, None).unwrap();
    push(&s.local).unwrap();
    assert!(tag_on(&s.remote, "v1.0").is_some());

    let cancel = CancelToken::new();
    remote::delete_tag(git, s.local.path(), "origin", "v1.0", &cancel).unwrap();
    assert_eq!(tag_on(&s.remote, "v1.0"), None);
    // Already gone: nothing to do.
    remote::delete_tag(git, s.local.path(), "origin", "v1.0", &cancel).unwrap();
}

#[test]
fn publish_creates_remote_branch_and_upstream() {
    let s = Setup::new();
    s.local.git(["switch", "--quiet", "-c", "feature/한글"]);
    s.local.write("mine.txt", "mine\n");
    let commit = s.local.commit_all("feature work");

    tag::create(s.local.git_handle(), s.local.path(), "v2.0", &commit, None).unwrap();

    remote::publish(
        s.local.git_handle(),
        s.local.path(),
        "origin",
        &CancelToken::new(),
        |_| {},
    )
    .unwrap();
    assert_eq!(remote_head(&s.remote, "feature/한글"), commit);
    assert_eq!(tag_on(&s.remote, "v2.0").as_deref(), Some(commit.as_str()));
    let upstream = status::status(s.local.git_handle(), s.local.path())
        .unwrap()
        .branch
        .upstream;
    assert_eq!(upstream.as_deref(), Some("origin/feature/한글"));

    // Later pushes go to the upstream.
    s.local.write("more.txt", "more\n");
    let commit = s.local.commit_all("more work");
    push(&s.local).unwrap();
    assert_eq!(remote_head(&s.remote, "feature/한글"), commit);
}

#[test]
fn publish_rejects_unknown_remote() {
    let s = Setup::new();
    let err = remote::publish(
        s.local.git_handle(),
        s.local.path(),
        "nope",
        &CancelToken::new(),
        |_| {},
    )
    .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NoRemote);
}

#[test]
fn cancelled_operations_do_not_run() {
    let s = Setup::new();
    s.commit_upstream("new.txt", "new\n");
    let cancel = CancelToken::new();
    cancel.cancel();
    let err =
        remote::pull(s.local.git_handle(), s.local.path(), false, &cancel, |_| {}).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Cancelled);
    assert_eq!(ahead_behind(&s.local), (0, 0));
}

/// The askpass program receives git's prompt and its stdout is the answer.
#[cfg(unix)]
#[test]
fn askpass_answers_credential_prompts() {
    use std::os::unix::fs::PermissionsExt;

    let repo = TestRepo::new();
    let script = repo.write(
        "askpass.sh",
        "#!/bin/sh\ncase \"$1\" in\n  Username*) echo garam-user ;;\n  *) echo \"secret for $1\" ;;\nesac\n",
    );
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

    let git = repo.git_handle().clone().with_askpass(&script);
    let output = git
        .command()
        .cwd(repo.path())
        .args(["credential", "fill"])
        .stdin("protocol=https\nhost=example.com\n\n")
        .run()
        .unwrap();
    let text = output.stdout_str();
    assert!(text.contains("username=garam-user"), "{text}");
    assert!(
        text.contains("password=secret for Password for 'https://garam-user@example.com': "),
        "{text}"
    );
}

fn pull_stashing(repo: &TestRepo) -> Result<PullOutcome, garam_git::GitError> {
    remote::pull(
        repo.git_handle(),
        repo.path(),
        true,
        &CancelToken::new(),
        |_| {},
    )
}

/// Upstream and local each have a commit, so pulling has to merge.
fn diverged() -> Setup {
    let s = Setup::new();
    s.commit_upstream("theirs.txt", "theirs\n");
    s.local.write("mine.txt", "mine\n");
    s.local.commit_all("local work");
    s
}

#[test]
fn local_changes_in_the_way_block_a_pull_until_stashed() {
    let s = diverged();
    // Any staged change stops a merge.
    s.local.write("notes.txt", "note\n");
    s.local.git(["add", "notes.txt"]);
    s.local.write("file.txt", "edited\n");

    let err = pull(&s.local).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::PullBlockedByLocalChanges);

    assert_eq!(pull_stashing(&s.local).unwrap(), PullOutcome::Updated);
    assert_eq!(ahead_behind(&s.local), (2, 0));
    assert!(s.local.path().join("theirs.txt").exists());
    // The changes are back, the staged one still staged.
    let status = status::status(s.local.git_handle(), s.local.path()).unwrap();
    let file = |p: &str| status.files.iter().find(|f| f.path == p).unwrap().clone();
    assert!(file("notes.txt").staged.is_some());
    assert!(file("file.txt").unstaged.is_some());
    assert!(s.local.git(["stash", "list"]).stdout_str().is_empty());
}

#[test]
fn a_rebase_pull_is_blocked_the_same_way() {
    let s = diverged();
    s.local.git(["config", "pull.rebase", "true"]);
    s.local.write("file.txt", "edited\n");
    let err = pull(&s.local).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::PullBlockedByLocalChanges);
    assert_eq!(pull_stashing(&s.local).unwrap(), PullOutcome::Updated);
    assert_eq!(
        std::fs::read_to_string(s.local.path().join("file.txt")).unwrap(),
        "edited\n"
    );
}

#[test]
fn stashed_changes_that_clash_are_left_conflicted_and_kept() {
    let s = diverged();
    s.commit_upstream("file.txt", "upstream\n");
    s.local.git(["fetch", "--quiet"]);
    s.local.write("file.txt", "mine\n");

    assert_eq!(
        pull_stashing(&s.local).unwrap(),
        PullOutcome::UpdatedWithConflicts
    );
    let state = garam_git::conflict::state(s.local.git_handle(), s.local.path()).unwrap();
    assert_eq!(state.files.len(), 1);
    assert_eq!(state.operation, None);
    assert!(
        s.local
            .git(["stash", "list"])
            .stdout_str()
            .contains("autostash")
    );
}
