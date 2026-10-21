use garam_git::testing::TestRepo;
use garam_git::{ErrorKind, Git};

#[test]
fn locates_a_supported_git() {
    let git = Git::locate().expect("git should be installed");
    let version = git
        .require_supported_version()
        .expect("git should be new enough");
    assert!(version.is_supported());
}

#[test]
fn reports_not_a_repository() {
    let dir = TestRepo::plain_dir();
    let err = dir
        .git_handle()
        .command()
        .cwd(dir.path())
        .args(["rev-parse", "--git-dir"])
        .run()
        .expect_err("a plain directory is not a repository");
    assert_eq!(err.kind(), ErrorKind::NotARepository);
    assert!(err.detail().unwrap().contains("not a git repository"));
}

#[test]
fn keeps_non_ascii_paths_unquoted() {
    let repo = TestRepo::new();
    repo.write("문서/한글 파일.txt", "안녕하세요\n");
    repo.commit_all("add korean file");

    let output = repo.git(["ls-files"]);
    assert_eq!(output.stdout_str().trim(), "문서/한글 파일.txt");
}

#[test]
fn never_prompts_and_uses_c_locale() {
    let repo = TestRepo::new();
    // Even if the user's locale is Korean, git's messages must stay English.
    let err = repo
        .git_handle()
        .command()
        .cwd(repo.path())
        .env("LANG", "ko_KR.UTF-8")
        .args(["checkout", "does-not-exist"])
        .run()
        .expect_err("unknown branch");
    assert!(
        err.detail().unwrap().contains("did not match"),
        "unexpected stderr: {:?}",
        err.detail()
    );
}

#[test]
fn passes_stdin() {
    let repo = TestRepo::new();
    let output = repo
        .git_handle()
        .command()
        .cwd(repo.path())
        .args(["hash-object", "--stdin"])
        .stdin("hello\n")
        .run()
        .unwrap();
    assert_eq!(
        output.stdout_str().trim(),
        "ce013625030ba8dba906f756967f9e9ca394464a"
    );
}

#[test]
fn paths_after_double_dash_are_not_options() {
    let repo = TestRepo::new();
    repo.write("-n", "dash file\n");
    repo.git_handle()
        .command()
        .cwd(repo.path())
        .arg("add")
        .paths(["-n"])
        .run()
        .unwrap();
    assert_eq!(repo.git(["ls-files"]).stdout_str().trim(), "-n");
}
