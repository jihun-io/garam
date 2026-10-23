use std::fs;

use garam_git::precommit::{self, Finding, LARGE_FILE, SecretKind};
use garam_git::testing::TestRepo;

/// `a.txt` committed as "base".
fn repo() -> TestRepo {
    let repo = TestRepo::new();
    repo.write("a.txt", "base\n");
    repo.commit_all("base");
    repo
}

fn check(repo: &TestRepo) -> Vec<Finding> {
    precommit::check(repo.git_handle(), repo.path()).unwrap()
}

fn stage_all(repo: &TestRepo) {
    repo.git(["add", "--all"]);
}

const TOKEN: &str = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

#[test]
fn nothing_staged_finds_nothing() {
    let repo = repo();
    repo.write(".env", "SECRET=1\n");
    assert_eq!(check(&repo), []);
}

#[test]
fn finds_secrets_on_added_lines_with_their_line() {
    let repo = repo();
    repo.write("config.js", "const a = 1;\n");
    repo.commit_all("config");
    repo.write(
        "config.js",
        format!("const a = 1;\nconst token = \"{TOKEN}\";\n"),
    );
    stage_all(&repo);

    assert_eq!(
        check(&repo),
        [Finding::Secret {
            path: "config.js".into(),
            secret: SecretKind::GithubToken,
            line: Some(2),
            preview: Some("ghp_…6789".into()),
        }]
    );
}

#[test]
fn a_removed_token_is_not_a_finding() {
    let repo = repo();
    repo.write("config.js", format!("token = {TOKEN}\n"));
    repo.commit_all("oops");
    repo.write("config.js", "token = from_env()\n");
    stage_all(&repo);
    assert_eq!(check(&repo), []);
}

#[test]
fn finds_secret_files_by_name() {
    let repo = repo();
    repo.write(".env", "SECRET=1\n");
    repo.write(".env.example", "SECRET=\n");
    repo.write("keys/id_rsa", "not really\n");
    stage_all(&repo);

    let kinds: Vec<_> = check(&repo)
        .into_iter()
        .map(|f| match f {
            Finding::Secret {
                path, secret, line, ..
            } => (path, secret, line),
            other => panic!("unexpected {other:?}"),
        })
        .collect();
    assert_eq!(
        kinds,
        [
            (".env".to_owned(), SecretKind::EnvFile, None),
            ("keys/id_rsa".to_owned(), SecretKind::KeyFile, None),
        ]
    );
}

#[test]
fn a_moved_file_does_not_warn_about_its_content_again() {
    let repo = repo();
    repo.write(
        "old.js",
        format!("token = {TOKEN}\nmore\nlines\nso it is a rename\n"),
    );
    repo.commit_all("committed before Garam checked");
    repo.git(["mv", "old.js", "new.js"]);
    assert_eq!(check(&repo), []);
}

#[test]
fn reports_large_blobs_from_the_limit() {
    let repo = repo();
    let size = usize::try_from(LARGE_FILE).unwrap();
    repo.write("small.bin", vec![0u8; size - 1]);
    repo.write("large.bin", vec![0u8; size]);
    stage_all(&repo);
    assert_eq!(
        check(&repo),
        [Finding::LargeFile {
            path: "large.bin".into(),
            mib: 50
        }]
    );
}

#[test]
fn suggests_ignoring_newly_added_dependency_and_os_files() {
    let repo = repo();
    repo.write("node_modules/a/index.js", "1\n");
    repo.write("web/node_modules/b/index.js", "2\n");
    repo.write("docs/.DS_Store", "x");
    repo.write("tool/Cargo.toml", "[package]\n");
    repo.write("tool/target/debug/app", "bin");
    // Not next to a Cargo.toml: someone's own folder.
    repo.write("site/target/index.html", "<p>\n");
    repo.write("env/pyvenv.cfg", "home = /usr\n");
    repo.write("env/lib/x.py", "x\n");
    stage_all(&repo);

    let groups: Vec<_> = check(&repo)
        .into_iter()
        .map(|f| match f {
            Finding::Ignorable { pattern, paths } => (pattern, paths),
            other => panic!("unexpected {other:?}"),
        })
        .collect();
    assert_eq!(
        groups,
        [
            (".DS_Store".to_owned(), vec!["docs/.DS_Store".to_owned()]),
            (
                "/env/".to_owned(),
                vec!["env/lib/x.py".into(), "env/pyvenv.cfg".into()]
            ),
            (
                "node_modules/".to_owned(),
                vec![
                    "node_modules/a/index.js".into(),
                    "web/node_modules/b/index.js".into()
                ]
            ),
            (
                "/tool/target/".to_owned(),
                vec!["tool/target/debug/app".into()]
            ),
        ]
    );
}

#[test]
fn tracked_files_are_not_suggested() {
    let repo = repo();
    repo.write("node_modules/a/index.js", "1\n");
    repo.commit_all("too late");
    repo.write("node_modules/a/index.js", "2\n");
    stage_all(&repo);
    assert_eq!(check(&repo), []);
}

#[test]
fn ignoring_adds_the_line_and_leaves_the_files_out() {
    let repo = repo();
    repo.write(".gitignore", "dist/");
    repo.commit_all("ignore");
    repo.write("node_modules/a/index.js", "1\n");
    repo.write("src/main.js", "main\n");
    stage_all(&repo);

    precommit::ignore(
        repo.git_handle(),
        repo.path(),
        &["node_modules/".into(), "dist/".into()],
        &["node_modules/a/index.js".into()],
    )
    .unwrap();

    // The missing newline is added first, and the line already there isn't
    // repeated.
    assert_eq!(
        fs::read_to_string(repo.path().join(".gitignore")).unwrap(),
        "dist/\nnode_modules/\n"
    );
    let status = repo.git(["status", "--short"]).stdout_str().into_owned();
    assert_eq!(status, "M  .gitignore\nA  src/main.js\n");
    assert_eq!(check(&repo), []);
}

#[test]
fn ignoring_creates_the_file_in_a_repository_without_commits() {
    let repo = TestRepo::new();
    repo.write(".DS_Store", "x");
    repo.write("a.txt", "a\n");
    stage_all(&repo);

    precommit::ignore(
        repo.git_handle(),
        repo.path(),
        &[".DS_Store".into()],
        &[".DS_Store".into()],
    )
    .unwrap();

    assert_eq!(
        fs::read_to_string(repo.path().join(".gitignore")).unwrap(),
        ".DS_Store\n"
    );
    let status = repo.git(["status", "--short"]).stdout_str().into_owned();
    assert_eq!(status, "A  .gitignore\nA  a.txt\n");
}

#[test]
fn a_file_named_like_a_secret_is_reported_once() {
    let repo = repo();
    repo.write(".env", format!("TOKEN={TOKEN}\n"));
    // Over the reading limit: not read, even though it holds a token.
    repo.write(
        "dump.sql",
        format!("{TOKEN}\n{}", "x".repeat(2 * 1024 * 1024)),
    );
    repo.write("app.js", format!("const t = '{TOKEN}';\n"));
    stage_all(&repo);

    let found: Vec<_> = check(&repo)
        .into_iter()
        .map(|f| match f {
            Finding::Secret { path, line, .. } => (path, line),
            other => panic!("unexpected {other:?}"),
        })
        .collect();
    assert_eq!(
        found,
        [(".env".to_owned(), None), ("app.js".to_owned(), Some(1))]
    );
}
