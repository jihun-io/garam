//! Test fixtures. Enabled with the `testing` feature.

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use crate::{Git, GitOutput};

/// A throwaway git repository in a temp directory.
///
/// The repository is isolated from the developer's own git configuration:
/// system and global config are disabled, and a fixed identity is set, so
/// tests behave the same on every machine and in CI.
pub struct TestRepo {
    dir: TempDir,
    // Holds the isolated git config, outside the repository's work tree.
    _home: TempDir,
    git: Git,
}

impl TestRepo {
    /// Creates an empty repository on branch `main`.
    pub fn new() -> Self {
        let repo = Self::plain_dir();
        repo.git(["init", "--initial-branch=main"]);
        repo
    }

    /// Creates an empty bare repository on branch `main`, to act as a remote.
    pub fn bare() -> Self {
        let repo = Self::plain_dir();
        repo.git(["init", "--bare", "--initial-branch=main"]);
        repo
    }

    /// Clones `remote` (as `origin`) into a new repository.
    pub fn clone_of(remote: &TestRepo) -> Self {
        let repo = Self::plain_dir();
        repo.git([
            std::ffi::OsStr::new("clone"),
            std::ffi::OsStr::new("--quiet"),
            remote.path().as_os_str(),
            std::ffi::OsStr::new("."),
        ]);
        repo
    }

    /// Creates an empty directory that is *not* a git repository.
    pub fn plain_dir() -> Self {
        let dir = tempfile::Builder::new()
            .prefix("garam-test-")
            .tempdir()
            .expect("create temp dir");
        let home = tempfile::Builder::new()
            .prefix("garam-test-home-")
            .tempdir()
            .expect("create temp home");
        let global_config = home.path().join(".gitconfig");
        fs::write(
            &global_config,
            "[user]\n\tname = Garam Test\n\temail = test@garam.invalid\n\
             [commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n",
        )
        .expect("write test gitconfig");

        let git = Git::locate()
            .expect("git must be installed to run tests")
            .with_env("GIT_CONFIG_NOSYSTEM", "1")
            .with_env("GIT_CONFIG_GLOBAL", global_config);

        Self {
            dir,
            _home: home,
            git,
        }
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    /// The isolated git handle for this repository.
    pub fn git_handle(&self) -> &Git {
        &self.git
    }

    /// Runs git in the repository and panics on failure.
    pub fn git<I, S>(&self, args: I) -> GitOutput
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        self.git
            .command()
            .cwd(self.path())
            .args(args)
            .run()
            .unwrap_or_else(|e| panic!("git failed in test repo: {e}"))
    }

    /// Writes `contents` to `rel` (creating parent directories) and returns
    /// the absolute path.
    pub fn write(&self, rel: impl AsRef<Path>, contents: impl AsRef<[u8]>) -> PathBuf {
        let path = self.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent dirs");
        }
        fs::write(&path, contents).expect("write file");
        path
    }

    /// Stages everything and commits. Returns the new commit's hash.
    pub fn commit_all(&self, message: &str) -> String {
        self.git(["add", "--all"]);
        self.git(["commit", "--quiet", "--allow-empty", "-m", message]);
        self.git(["rev-parse", "HEAD"])
            .stdout_str()
            .trim()
            .to_owned()
    }
}

impl Default for TestRepo {
    fn default() -> Self {
        Self::new()
    }
}
