use std::borrow::Cow;
use std::ffi::{OsStr, OsString};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::{Git, GitError};

/// Builder for a single git invocation.
///
/// Enforces the rules from `docs/ARCHITECTURE.md` section 2.2:
/// - `LC_ALL=C` / `LANGUAGE=C` so output can be parsed and classified.
/// - `GIT_TERMINAL_PROMPT=0` so git never blocks on a terminal prompt.
/// - `core.quotePath=false` so non-ASCII paths (e.g. Korean) arrive verbatim.
/// - Arguments are passed as an argv array, never through a shell.
pub struct GitCommand<'a> {
    git: &'a Git,
    cwd: Option<PathBuf>,
    global_args: Vec<OsString>,
    args: Vec<OsString>,
    envs: Vec<(OsString, OsString)>,
    stdin: Option<Vec<u8>>,
}

impl<'a> GitCommand<'a> {
    pub(crate) fn new(git: &'a Git) -> Self {
        Self {
            git,
            cwd: None,
            global_args: vec!["-c".into(), "core.quotePath=false".into()],
            args: Vec::new(),
            envs: Vec::new(),
            stdin: None,
        }
    }

    /// Runs git inside `dir`.
    pub fn cwd(mut self, dir: impl AsRef<Path>) -> Self {
        self.cwd = Some(dir.as_ref().to_path_buf());
        self
    }

    /// Marks the command as read-only, so git skips optional locks such as
    /// refreshing the index during `status`. Avoids `index.lock` clashes with
    /// git commands the user runs at the same time.
    pub fn read_only(mut self) -> Self {
        self.global_args.push("--no-optional-locks".into());
        self
    }

    /// Adds a `-c key=value` config override.
    pub fn config(mut self, key: &str, value: &str) -> Self {
        self.global_args.push("-c".into());
        self.global_args.push(format!("{key}={value}").into());
        self
    }

    pub fn arg(mut self, arg: impl AsRef<OsStr>) -> Self {
        self.args.push(arg.as_ref().to_os_string());
        self
    }

    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.args
            .extend(args.into_iter().map(|a| a.as_ref().to_os_string()));
        self
    }

    /// Appends `--` followed by `paths`, so paths starting with `-` are never
    /// mistaken for options.
    pub fn paths<I, P>(self, paths: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        self.arg("--").args(
            paths
                .into_iter()
                .map(|p| p.as_ref().as_os_str().to_os_string()),
        )
    }

    pub fn env(mut self, key: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        self.envs.push((key.into(), value.into()));
        self
    }

    pub fn stdin(mut self, input: impl Into<Vec<u8>>) -> Self {
        self.stdin = Some(input.into());
        self
    }

    /// Runs the command and fails with [`GitError::Failed`] on a non-zero exit.
    pub fn run(self) -> Result<GitOutput, GitError> {
        let output = self.run_unchecked()?;
        if output.success() {
            Ok(output)
        } else {
            Err(GitError::failed(
                output.code,
                output.stderr_str().into_owned(),
            ))
        }
    }

    /// Runs the command and returns its output regardless of the exit code.
    /// For commands where a non-zero exit is an expected answer, such as
    /// `git diff --quiet`.
    pub fn run_unchecked(self) -> Result<GitOutput, GitError> {
        let mut command = Command::new(self.git.path());
        command
            .args(&self.global_args)
            .args(&self.args)
            .env("LC_ALL", "C")
            .env("LANGUAGE", "C")
            .env("GIT_TERMINAL_PROMPT", "0")
            .envs(self.git.envs().iter().map(|(k, v)| (k, v)))
            .envs(self.envs.iter().map(|(k, v)| (k, v)))
            .stdin(if self.stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = &self.cwd {
            command.current_dir(dir);
        }

        let mut child = command.spawn().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => GitError::NotFound,
            _ => GitError::Io(e),
        })?;

        if let Some(input) = self.stdin {
            // Write from a separate thread so a large stdin cannot deadlock
            // against git filling its stdout pipe.
            let mut pipe = child.stdin.take().expect("stdin was piped");
            let writer = std::thread::spawn(move || pipe.write_all(&input));
            let output = child.wait_with_output()?;
            writer.join().expect("stdin writer panicked")?;
            return Ok(GitOutput::from(output));
        }

        Ok(GitOutput::from(child.wait_with_output()?))
    }
}

#[derive(Debug, Clone)]
pub struct GitOutput {
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl GitOutput {
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }

    pub fn stdout_str(&self) -> Cow<'_, str> {
        String::from_utf8_lossy(&self.stdout)
    }

    pub fn stderr_str(&self) -> Cow<'_, str> {
        String::from_utf8_lossy(&self.stderr)
    }
}

impl From<std::process::Output> for GitOutput {
    fn from(output: std::process::Output) -> Self {
        Self {
            code: output.status.code(),
            stdout: output.stdout,
            stderr: output.stderr,
        }
    }
}
