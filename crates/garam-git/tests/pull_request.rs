use garam_git::pull_request;
use garam_git::testing::TestRepo;

fn template(repo: &TestRepo, base: &str) -> Option<String> {
    pull_request::template(repo.git_handle(), repo.path(), base).unwrap()
}

#[test]
fn no_template_gives_none() {
    let repo = TestRepo::new();
    repo.write("README.md", "hi\n");
    repo.commit_all("init");
    assert_eq!(template(&repo, "refs/heads/main"), None);
}

#[test]
fn finds_a_template_in_any_letter_case() {
    let repo = TestRepo::new();
    repo.write(".github/PULL_REQUEST_TEMPLATE.md", "## Summary\n");
    repo.commit_all("init");
    assert_eq!(
        template(&repo, "refs/heads/main").as_deref(),
        Some("## Summary\n")
    );
}

#[test]
fn prefers_github_folder_then_root_then_docs() {
    let repo = TestRepo::new();
    repo.write("docs/pull_request_template.md", "docs\n");
    repo.commit_all("docs");
    assert_eq!(
        template(&repo, "refs/heads/main").as_deref(),
        Some("docs\n")
    );

    repo.write("pull_request_template.md", "root\n");
    repo.commit_all("root");
    assert_eq!(
        template(&repo, "refs/heads/main").as_deref(),
        Some("root\n")
    );

    repo.write(".github/pull_request_template.md", "github\n");
    repo.commit_all("github");
    assert_eq!(
        template(&repo, "refs/heads/main").as_deref(),
        Some("github\n")
    );
}

#[test]
fn ignores_templates_deeper_in_the_tree() {
    let repo = TestRepo::new();
    repo.write("docs/old/pull_request_template.md", "old\n");
    repo.write(".github/PULL_REQUEST_TEMPLATE/feature.md", "many\n");
    repo.commit_all("init");
    assert_eq!(template(&repo, "refs/heads/main"), None);
}

#[test]
fn reads_the_template_on_the_base_not_the_current_branch() {
    let repo = TestRepo::new();
    repo.write(".github/pull_request_template.md", "base\n");
    repo.commit_all("init");
    repo.git(["switch", "--quiet", "-c", "feature"]);
    repo.write(".github/pull_request_template.md", "feature\n");
    repo.commit_all("change template");

    assert_eq!(
        template(&repo, "refs/heads/main").as_deref(),
        Some("base\n")
    );
}

#[test]
fn a_missing_base_gives_none() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("init");
    assert_eq!(template(&repo, "refs/remotes/origin/main"), None);
}

#[test]
fn lists_upstreams_with_their_remote_branch_names() {
    let remote = TestRepo::bare();
    let local = TestRepo::clone_of(&remote);
    local.write("a.txt", "a\n");
    local.commit_all("init");
    local.git(["remote", "rename", "origin", "my/fork"]);
    local.git(["push", "--quiet", "-u", "my/fork", "main"]);
    // Tracks a branch of another name.
    local.git(["switch", "--quiet", "-c", "topic"]);
    local.git(["push", "--quiet", "-u", "my/fork", "topic:feature/topic"]);
    // No upstream, and an upstream on a local branch.
    local.git(["branch", "--quiet", "loose"]);
    local.git(["branch", "--quiet", "--track", "local-only", "main"]);

    let list = garam_git::branch::upstreams(local.git_handle(), local.path()).unwrap();
    let summary: Vec<_> = list
        .iter()
        .map(|u| {
            (
                u.branch.as_str(),
                u.remote.as_str(),
                u.remote_branch.as_str(),
                u.is_head,
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            ("main", "my/fork", "main", false),
            ("topic", "my/fork", "feature/topic", true),
        ]
    );
}

#[test]
fn reads_the_remote_default_branch_a_clone_recorded() {
    let remote = TestRepo::new();
    remote.write("a.txt", "a\n");
    remote.commit_all("init");
    remote.git(["branch", "--quiet", "-m", "master"]);
    let local = TestRepo::clone_of(&remote);
    let default = |name: &str| {
        garam_git::remote::default_branch(local.git_handle(), local.path(), name).unwrap()
    };
    assert_eq!(default("origin").as_deref(), Some("master"));

    // A remote added by hand has no HEAD until a fetch records it (git
    // 2.48+) or `remote set-head` does.
    local.git(["remote", "add", "my/fork", remote.path().to_str().unwrap()]);
    assert_eq!(default("my/fork"), None);
    local.git(["fetch", "--quiet", "my/fork"]);
    local.git(["remote", "set-head", "my/fork", "--auto"]);
    assert_eq!(default("my/fork").as_deref(), Some("master"));
}
