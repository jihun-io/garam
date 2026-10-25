use std::fs;

use garam_git::ssh::{self, RepoSshKey};
use garam_git::testing::TestRepo;

#[test]
fn lists_private_keys_that_have_a_public_half() {
    let dir = tempfile::tempdir().unwrap();
    let ssh_dir = dir.path();
    fs::write(ssh_dir.join("id_ed25519"), "private").unwrap();
    fs::write(
        ssh_dir.join("id_ed25519.pub"),
        "ssh-ed25519 AAAAC3Nza kim@jihun.io\n",
    )
    .unwrap();
    fs::write(ssh_dir.join("work"), "private").unwrap();
    fs::write(ssh_dir.join("work.pub"), "ssh-rsa AAAAB3Nza\n").unwrap();
    // Not keys: no public half, or not a key file at all.
    fs::write(ssh_dir.join("config"), "Host *").unwrap();
    fs::write(ssh_dir.join("known_hosts"), "github.com ssh-ed25519 AAAA").unwrap();
    fs::write(ssh_dir.join("lonely.pub"), "ssh-ed25519 AAAA").unwrap();
    fs::write(ssh_dir.join("broken"), "private").unwrap();
    fs::write(ssh_dir.join("broken.pub"), "garbage").unwrap();

    let keys = ssh::list_keys(ssh_dir);
    let names: Vec<_> = keys
        .iter()
        .map(|k| (k.path.rsplit(['/', '\\']).next().unwrap(), k.kind.as_str()))
        .collect();
    assert_eq!(names, [("id_ed25519", "ssh-ed25519"), ("work", "ssh-rsa")]);
    assert_eq!(keys[0].comment.as_deref(), Some("kim@jihun.io"));
    assert_eq!(keys[1].comment, None);

    assert!(ssh::list_keys(&ssh_dir.join("missing")).is_empty());
}

#[test]
fn sets_and_clears_the_repository_key() {
    let repo = TestRepo::new();
    let git = repo.git_handle();
    assert_eq!(ssh::repo_key(git, repo.path()).unwrap(), RepoSshKey::None);

    let key = repo.path().join("my keys").join("it's personal");
    ssh::set_repo_key(git, repo.path(), Some(&key)).unwrap();
    let RepoSshKey::Key { path } = ssh::repo_key(git, repo.path()).unwrap() else {
        panic!("expected a key");
    };
    assert_eq!(
        path.replace('\\', "/"),
        key.to_string_lossy().replace('\\', "/")
    );
    // Stored in the repository's own config, so the command line uses it.
    let stored = repo.git(["config", "--local", "core.sshCommand"]);
    assert!(stored.stdout_str().contains("IdentitiesOnly=yes"));

    ssh::set_repo_key(git, repo.path(), None).unwrap();
    assert_eq!(ssh::repo_key(git, repo.path()).unwrap(), RepoSshKey::None);
    // Clearing twice is fine.
    ssh::set_repo_key(git, repo.path(), None).unwrap();
}

#[test]
fn reports_commands_it_did_not_write() {
    let repo = TestRepo::new();
    repo.git([
        "config",
        "--local",
        "core.sshCommand",
        "ssh -F ~/.ssh/work_config",
    ]);
    assert_eq!(
        ssh::repo_key(repo.git_handle(), repo.path()).unwrap(),
        RepoSshKey::Custom {
            command: "ssh -F ~/.ssh/work_config".into()
        }
    );
}
