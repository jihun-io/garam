use garam_git::config::{self, GlobalKey};
use garam_git::testing::TestRepo;
use garam_git::{ErrorKind, repo};

#[test]
fn reads_and_writes_global_settings() {
    let repo = TestRepo::new();
    let git = repo.git_handle();

    // The test identity comes from the isolated global config.
    let settings = config::global_settings(git).unwrap();
    assert_eq!(settings.user_name.as_deref(), Some("Garam Test"));
    assert_eq!(settings.default_branch, None);

    config::set(git, GlobalKey::UserName, "  김가람 ").unwrap();
    config::set(git, GlobalKey::DefaultBranch, "trunk").unwrap();
    let settings = config::global_settings(git).unwrap();
    assert_eq!(settings.user_name.as_deref(), Some("김가람"));
    assert_eq!(settings.default_branch.as_deref(), Some("trunk"));

    // New repositories pick up the default branch.
    let dir = TestRepo::plain_dir();
    let created = repo::init(git, dir.path()).unwrap();
    let head = repo
        .git_handle()
        .command()
        .cwd(&created.path)
        .args(["symbolic-ref", "--short", "HEAD"])
        .run()
        .unwrap();
    assert_eq!(head.stdout_str().trim(), "trunk");
}

#[test]
fn clearing_a_value_unsets_it() {
    let repo = TestRepo::new();
    let git = repo.git_handle();
    config::set(git, GlobalKey::DefaultBranch, "").unwrap();
    config::set(git, GlobalKey::DefaultBranch, "develop").unwrap();
    config::set(git, GlobalKey::DefaultBranch, "  ").unwrap();
    assert_eq!(config::global_settings(git).unwrap().default_branch, None);
}

#[test]
fn rejects_invalid_default_branch_names() {
    let repo = TestRepo::new();
    let err = config::set(repo.git_handle(), GlobalKey::DefaultBranch, "bad name..").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::InvalidBranchName);
}
