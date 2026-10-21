use std::fs;

use garam_git::testing::TestRepo;
use garam_git::{CancelToken, ErrorKind, repo};

fn canonical(path: &std::path::Path) -> String {
    dunce::canonicalize(path).unwrap().display().to_string()
}

#[test]
fn opens_repository_from_a_subdirectory() {
    let r = TestRepo::new();
    r.write("src/lib.rs", "");
    let info = repo::open(r.git_handle(), &r.path().join("src")).unwrap();
    assert_eq!(info.path, canonical(r.path()));
    assert_eq!(info.name, r.path().file_name().unwrap().to_string_lossy());
}

#[test]
fn rejects_plain_directories_and_missing_paths() {
    let dir = TestRepo::plain_dir();
    let err = repo::open(dir.git_handle(), dir.path()).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NotARepository);

    let err = repo::open(dir.git_handle(), &dir.path().join("nope")).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::PathNotFound);
}

#[test]
fn rejects_bare_repositories() {
    let dir = TestRepo::plain_dir();
    dir.git(["init", "--bare", "--quiet", "bare.git"]);
    let err = repo::open(dir.git_handle(), &dir.path().join("bare.git")).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::BareRepository);
}

#[test]
fn init_creates_directory_with_main_branch() {
    let dir = TestRepo::plain_dir();
    let target = dir.path().join("새 저장소");
    let info = repo::init(dir.git_handle(), &target).unwrap();
    assert_eq!(info.name, "새 저장소");

    let head = dir
        .git_handle()
        .command()
        .cwd(&target)
        .args(["symbolic-ref", "--short", "HEAD"])
        .run()
        .unwrap();
    assert_eq!(head.stdout_str().trim(), "main");
}

#[test]
fn clones_with_progress() {
    let source = TestRepo::new();
    for i in 0..20 {
        source.write(format!("file{i}.txt"), format!("content {i}\n").repeat(100));
    }
    source.commit_all("initial");

    let dest_root = TestRepo::plain_dir();
    let dest = dest_root.path().join("clone");
    // file:// forces the pack transport, which reports progress.
    let url = format!("file://{}", source.path().display()).replace('\\', "/");
    let mut updates = Vec::new();
    let info = repo::clone(
        dest_root.git_handle(),
        &url,
        &dest,
        &CancelToken::new(),
        |p| updates.push(p),
    )
    .unwrap();

    assert_eq!(info.path, canonical(&dest));
    assert!(dest.join("file0.txt").is_file());
    assert!(!updates.is_empty(), "expected progress updates");
    assert!(
        updates
            .windows(2)
            .all(|w| w[0].overall_percent <= w[1].overall_percent)
    );
}

#[test]
fn clone_into_non_empty_directory_is_refused_and_left_alone() {
    let source = TestRepo::new();
    source.commit_all("initial");
    let dest_root = TestRepo::plain_dir();
    dest_root.write("taken/keep.txt", "mine");

    let err = repo::clone(
        dest_root.git_handle(),
        &source.path().display().to_string(),
        &dest_root.path().join("taken"),
        &CancelToken::new(),
        |_| {},
    )
    .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::DestinationNotEmpty);
    assert_eq!(
        fs::read_to_string(dest_root.path().join("taken/keep.txt")).unwrap(),
        "mine"
    );
}

#[test]
fn failed_clone_cleans_up() {
    let dest_root = TestRepo::plain_dir();
    let dest = dest_root.path().join("clone");
    let err = repo::clone(
        dest_root.git_handle(),
        &dest_root
            .path()
            .join("missing-source")
            .display()
            .to_string(),
        &dest,
        &CancelToken::new(),
        |_| {},
    )
    .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::RemoteNotFound);
    assert!(!dest.exists());
}

#[test]
fn cancelled_clone_cleans_up() {
    let source = TestRepo::new();
    source.commit_all("initial");
    let dest_root = TestRepo::plain_dir();
    let dest = dest_root.path().join("clone");

    let cancel = CancelToken::new();
    cancel.cancel();
    let err = repo::clone(
        dest_root.git_handle(),
        &source.path().display().to_string(),
        &dest,
        &cancel,
        |_| {},
    )
    .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Cancelled);
    assert!(!dest.exists());
}

#[test]
fn git_dir_itself_is_not_a_work_tree() {
    let r = TestRepo::new();
    let err = repo::open(r.git_handle(), &r.path().join(".git")).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NotARepository);
}
