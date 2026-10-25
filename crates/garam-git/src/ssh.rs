//! Per-repository SSH keys (`core.sshCommand`).
//!
//! SSH remotes sign in with SSH keys, not with a GitHub account's token.
//! To push to a personal repository on a work machine, the repository can
//! name its own key: Garam writes `ssh -i <key> -o IdentitiesOnly=yes` to
//! the repository's own config, so the command line uses the same key.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{Git, GitError};

const KEY: &str = "core.sshCommand";

/// A private key in `~/.ssh` that has a matching `.pub` file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    pub path: String,
    /// The key type, e.g. `ssh-ed25519`.
    pub kind: String,
    /// The public key's comment, often an email address.
    pub comment: Option<String>,
}

/// The repository's own `core.sshCommand`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RepoSshKey {
    /// Not set: ssh uses `~/.ssh/config` and the agent as usual.
    None,
    /// Set by Garam (or written the same way) to use this key.
    Key { path: String },
    /// Some other command the user wrote; Garam doesn't take it apart.
    Custom { command: String },
}

/// Private keys in `ssh_dir`, sorted by file name. A file counts as a key
/// when `<name>.pub` sits next to it, which skips `config`, `known_hosts`
/// and the like without reading them.
pub fn list_keys(ssh_dir: &Path) -> Vec<SshKey> {
    let Ok(entries) = fs::read_dir(ssh_dir) else {
        return Vec::new();
    };
    let mut keys: Vec<SshKey> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() || path.extension().is_some_and(|e| e == "pub") {
                return None;
            }
            let mut public = path.clone().into_os_string();
            public.push(".pub");
            let public = fs::read_to_string(PathBuf::from(public)).ok()?;
            let mut parts = public.split_whitespace();
            let kind = parts.next()?.to_owned();
            parts.next()?;
            let comment = parts.collect::<Vec<_>>().join(" ");
            Some(SshKey {
                path: path.to_string_lossy().into_owned(),
                kind,
                comment: (!comment.is_empty()).then_some(comment),
            })
        })
        .collect();
    keys.sort_by(|a, b| a.path.cmp(&b.path));
    keys
}

/// The SSH command `repo` sets in its own config.
pub fn repo_key(git: &Git, repo: &Path) -> Result<RepoSshKey, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["config", "--local", "--get", KEY])
        .run_unchecked()?;
    match output.code {
        Some(0) => {}
        // 1 = not set.
        Some(1) => return Ok(RepoSshKey::None),
        _ => return Err(GitError::failed(output.code, output.failure_text())),
    }
    let command = output.stdout_str().trim().to_owned();
    Ok(match parse_command(&command) {
        Some(path) => RepoSshKey::Key { path },
        None if command.is_empty() => RepoSshKey::None,
        None => RepoSshKey::Custom { command },
    })
}

/// Makes `repo` use the key at `key`, or the user's usual SSH setup again
/// with `None`. Replaces any command the repository had.
pub fn set_repo_key(git: &Git, repo: &Path, key: Option<&Path>) -> Result<(), GitError> {
    let Some(key) = key else {
        let output = git
            .command()
            .cwd(repo)
            .args(["config", "--local", "--unset-all", KEY])
            .run_unchecked()?;
        // 5 = wasn't set.
        if !output.success() && output.code != Some(5) {
            return Err(GitError::failed(output.code, output.failure_text()));
        }
        return Ok(());
    };
    git.command()
        .cwd(repo)
        .args(["config", "--local", "--replace-all", KEY])
        .arg(command_for(key))
        .run()?;
    Ok(())
}

/// The command for `key`. git runs it through a shell (Git for Windows
/// too), so the path is single-quoted; forward slashes work for both
/// OpenSSH builds on Windows.
fn command_for(key: &Path) -> String {
    let path = key.to_string_lossy();
    let path = if cfg!(windows) {
        path.replace('\\', "/")
    } else {
        path.into_owned()
    };
    format!(
        "ssh -i '{}' -o IdentitiesOnly=yes",
        path.replace('\'', r"'\''")
    )
}

/// The key path in a command [`command_for`] wrote, or `None` for any other
/// command.
fn parse_command(command: &str) -> Option<String> {
    let rest = command.strip_prefix("ssh -i '")?;
    let quoted = rest.strip_suffix("' -o IdentitiesOnly=yes")?;
    let path = quoted.replace(r"'\''", "'");
    // Anything else still quoted would be a command we didn't write.
    (!path.contains('\'') || quoted.contains(r"'\''")).then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_paths_with_quotes_and_spaces() {
        for path in ["/Users/me/.ssh/id_ed25519", "/Users/me/My Keys/it's key"] {
            let command = command_for(Path::new(path));
            assert_eq!(parse_command(&command).as_deref(), Some(path));
        }
    }

    #[test]
    fn leaves_other_commands_alone() {
        assert_eq!(parse_command("ssh -i ~/.ssh/work -F /dev/null"), None);
        assert_eq!(parse_command("ssh -i '/a' -o IdentitiesOnly=yes -v"), None);
        assert_eq!(parse_command("ssh -i 'a' 'b' -o IdentitiesOnly=yes"), None);
    }
}
