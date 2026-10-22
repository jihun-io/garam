use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::{GitCommand, GitError, GitVersion};

/// A located git executable plus environment applied to every invocation.
#[derive(Debug, Clone)]
pub struct Git {
    path: PathBuf,
    envs: Vec<(OsString, OsString)>,
}

impl Git {
    /// Uses the git executable at `path` as-is.
    pub fn at(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            envs: Vec::new(),
        }
    }

    /// Finds the git executable to use.
    ///
    /// `GARAM_GIT_PATH` wins if set. Otherwise `PATH` is searched, followed by
    /// well-known install locations: apps launched from Finder or a desktop
    /// launcher often get a minimal `PATH` that misses Homebrew and friends.
    pub fn locate() -> Result<Self, GitError> {
        if let Some(path) = env::var_os("GARAM_GIT_PATH") {
            let path = PathBuf::from(path);
            return if is_usable(&path) {
                Ok(Self::at(path))
            } else {
                Err(GitError::NotFound)
            };
        }

        let from_path = env::var_os("PATH")
            .map(|p| env::split_paths(&p).collect::<Vec<_>>())
            .unwrap_or_default();

        from_path
            .into_iter()
            .chain(extra_search_dirs())
            .map(|dir| dir.join(executable_name()))
            .find(|candidate| is_usable(candidate))
            .map(Self::at)
            .ok_or(GitError::NotFound)
    }

    /// Adds an environment variable to every command run through this handle.
    pub fn with_env(mut self, key: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        self.envs.push((key.into(), value.into()));
        self
    }

    /// Routes credential questions from git (HTTPS) and ssh (passphrases,
    /// host keys) to `program`, which receives the prompt as its argument
    /// and prints the answer, or exits non-zero to decline.
    pub fn with_askpass(self, program: impl Into<OsString>) -> Self {
        let program = program.into();
        let git = self
            .with_env("GIT_ASKPASS", program.clone())
            .with_env("SSH_ASKPASS", program)
            // Use askpass even when a terminal is attached (OpenSSH 8.4+).
            .with_env("SSH_ASKPASS_REQUIRE", "force");
        // Older ssh only uses SSH_ASKPASS when DISPLAY is set.
        if env::var_os("DISPLAY").is_none() {
            git.with_env("DISPLAY", ":0")
        } else {
            git
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn envs(&self) -> &[(OsString, OsString)] {
        &self.envs
    }

    /// Starts building a git command.
    pub fn command(&self) -> GitCommand<'_> {
        GitCommand::new(self)
    }

    pub fn version(&self) -> Result<GitVersion, GitError> {
        let output = self.command().arg("--version").run()?;
        let text = output.stdout_str();
        GitVersion::parse(&text).ok_or_else(|| GitError::Parse(text.into_owned()))
    }

    /// Like [`Git::version`], but fails if the version is below the minimum.
    pub fn require_supported_version(&self) -> Result<GitVersion, GitError> {
        let version = self.version()?;
        if version.is_supported() {
            Ok(version)
        } else {
            Err(GitError::TooOld {
                found: version,
                required: crate::MIN_GIT_VERSION,
            })
        }
    }
}

fn executable_name() -> &'static str {
    if cfg!(windows) { "git.exe" } else { "git" }
}

fn extra_search_dirs() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        vec![
            "/opt/homebrew/bin".into(),
            "/usr/local/bin".into(),
            "/usr/bin".into(),
        ]
    } else if cfg!(windows) {
        ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]
            .iter()
            .filter_map(env::var_os)
            .flat_map(|base| {
                let base = PathBuf::from(base);
                [
                    base.join("Git").join("cmd"),
                    base.join("Programs").join("Git").join("cmd"),
                ]
            })
            .collect()
    } else {
        vec!["/usr/local/bin".into(), "/usr/bin".into()]
    }
}

fn is_usable(path: &Path) -> bool {
    path.is_file() && !is_macos_git_shim_without_tools(path)
}

/// On macOS, `/usr/bin/git` is a shim that pops up an "install developer
/// tools" dialog when the Command Line Tools are missing. Treat that case as
/// "git not installed" so the app can show its own guidance instead.
#[cfg(target_os = "macos")]
fn is_macos_git_shim_without_tools(path: &Path) -> bool {
    use std::process::{Command, Stdio};

    if path != Path::new("/usr/bin/git") {
        return false;
    }
    !Command::new("/usr/bin/xcode-select")
        .arg("-p")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

#[cfg(not(target_os = "macos"))]
fn is_macos_git_shim_without_tools(_path: &Path) -> bool {
    false
}
