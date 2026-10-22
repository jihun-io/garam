use std::fs;

use garam_git::credential::{self, helper_command};
use garam_git::testing::TestRepo;

/// `git credential fill` asks the configured helpers, as a push would.
fn fill(git: &garam_git::Git, repo: &TestRepo, url: &str) -> String {
    let output = git
        .command()
        .cwd(repo.path())
        .args(["credential", "fill"])
        .stdin(format!("url={url}\n\n"))
        .run()
        .unwrap();
    output.stdout_str().into_owned()
}

#[test]
fn the_app_helper_replaces_the_users_helpers_for_its_host_only() {
    let repo = TestRepo::new();
    // The user's own helper, e.g. osxkeychain or `gh auth git-credential`.
    repo.git([
        "config",
        "--global",
        "credential.helper",
        "!f() { echo username=user; echo password=from-user-helper; }; f",
    ]);

    // A helper script standing in for Garam's executable; the path has a
    // space and a quote, which the shell quoting must survive.
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("it's garam");
    fs::write(
        &script,
        "#!/bin/sh\n[ \"$1\" = garam-credential ] && [ \"$2\" = get ] || exit 1\n\
         cat >/dev/null\necho username=jihun-io\necho password=gho_token\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let helper = helper_command(&script, &["garam-credential"]);
    let git = repo
        .git_handle()
        .clone()
        .with_credential_helper("https://github.com", &helper);

    let answer = fill(&git, &repo, "https://github.com/jihun-io/garam.git");
    let parsed = credential::parse_helper_request(&answer);
    assert_eq!(parsed.username.as_deref(), Some("jihun-io"));
    assert!(answer.contains("password=gho_token"), "{answer}");

    // Other hosts still use the user's helper.
    let answer = fill(&git, &repo, "https://gitlab.com/me/project.git");
    assert!(answer.contains("password=from-user-helper"), "{answer}");
}
