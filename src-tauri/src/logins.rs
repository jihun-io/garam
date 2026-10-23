//! Logins the user asked Garam to remember, for remotes where git has no
//! credential helper of its own (see `Askpass`).
//!
//! Which logins exist (protocol, host, username) lives in `logins.json`, so
//! settings can list them; each password or token lives in the OS keychain
//! and never leaves the backend.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::accounts::TokenVault;
use crate::error::AppResult;
use crate::storage::{self, now_ms};

/// Keychain service name for remembered git logins.
pub const KEYCHAIN_SERVICE: &str = "io.jihun.garam.git";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedLogin {
    /// `https` or `http`.
    pub protocol: String,
    /// With the port when there is one, e.g. `git.example.com:8443`.
    pub host: String,
    pub username: String,
    /// Milliseconds since the Unix epoch.
    pub saved_at: f64,
}

impl SavedLogin {
    fn is(&self, protocol: &str, host: &str, username: &str) -> bool {
        self.protocol == protocol
            && self.host.eq_ignore_ascii_case(host)
            && self.username == username
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct LoginFile {
    logins: Vec<SavedLogin>,
}

pub struct LoginStore {
    file: PathBuf,
    logins: Mutex<Vec<SavedLogin>>,
    vault: Box<dyn TokenVault>,
    /// Secrets already read this run; macOS may ask before each keychain
    /// read by a binary it doesn't recognize (see `AccountStore`).
    secrets: Mutex<HashMap<String, String>>,
}

impl LoginStore {
    pub fn load(file: PathBuf, vault: Box<dyn TokenVault>) -> Self {
        let stored: LoginFile = storage::load(&file);
        Self {
            file,
            logins: Mutex::new(stored.logins),
            vault,
            secrets: Mutex::new(HashMap::new()),
        }
    }

    /// Newest first. Saving moves a login to the end of the stored list,
    /// so its order is the order they were saved in.
    pub fn list(&self) -> Vec<SavedLogin> {
        lock(&self.logins).iter().rev().cloned().collect()
    }

    /// The username and secret for `host`; the newest one when git didn't
    /// say which user. `None` when nothing is saved for it.
    pub fn find(
        &self,
        protocol: &str,
        host: &str,
        username: Option<&str>,
    ) -> AppResult<Option<(String, String)>> {
        let login = self.list().into_iter().find(|l| {
            l.protocol == protocol
                && l.host.eq_ignore_ascii_case(host)
                && username.is_none_or(|u| u == l.username)
        });
        let Some(login) = login else {
            return Ok(None);
        };
        let key = vault_key(&login.protocol, &login.host, &login.username);
        if let Some(secret) = lock(&self.secrets).get(&key) {
            return Ok(Some((login.username, secret.clone())));
        }
        let Some(secret) = self.vault.get(&key)? else {
            return Ok(None);
        };
        lock(&self.secrets).insert(key, secret.clone());
        Ok(Some((login.username, secret)))
    }

    /// Saves (or replaces) the login for `username` at `host`.
    pub fn save(&self, protocol: &str, host: &str, username: &str, secret: &str) -> AppResult<()> {
        let key = vault_key(protocol, host, username);
        self.vault.set(&key, secret)?;
        lock(&self.secrets).insert(key, secret.to_owned());
        let mut logins = lock(&self.logins);
        logins.retain(|l| !l.is(protocol, host, username));
        logins.push(SavedLogin {
            protocol: protocol.to_owned(),
            host: host.to_owned(),
            username: username.to_owned(),
            saved_at: now_ms(),
        });
        self.write(&logins)
    }

    /// Forgets the login; nothing happens if it isn't saved.
    pub fn forget(&self, protocol: &str, host: &str, username: &str) -> AppResult<()> {
        let key = vault_key(protocol, host, username);
        self.vault.delete(&key)?;
        lock(&self.secrets).remove(&key);
        let mut logins = lock(&self.logins);
        let before = logins.len();
        logins.retain(|l| !l.is(protocol, host, username));
        if logins.len() == before {
            return Ok(());
        }
        self.write(&logins)
    }

    fn write(&self, logins: &[SavedLogin]) -> AppResult<()> {
        storage::save(
            &self.file,
            &LoginFile {
                logins: logins.to_vec(),
            },
        )
    }
}

/// `https://user@host`, the host lowercased so case doesn't split a login.
fn vault_key(protocol: &str, host: &str, username: &str) -> String {
    format!("{protocol}://{username}@{}", host.to_ascii_lowercase())
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::accounts::tests::MemoryVault;

    pub fn store(dir: &tempfile::TempDir, vault: MemoryVault) -> LoginStore {
        LoginStore::load(dir.path().join("logins.json"), Box::new(vault))
    }

    #[test]
    fn saves_finds_and_forgets_logins() {
        let dir = tempfile::tempdir().unwrap();
        let vault = MemoryVault::default();
        let logins = store(&dir, vault.clone());
        assert_eq!(logins.find("https", "git.example.com", None).unwrap(), None);

        logins
            .save("https", "git.example.com", "kim", "token-1")
            .unwrap();
        logins
            .save("https", "git.example.com", "lee", "token-2")
            .unwrap();
        // The newest one when git doesn't name the user.
        assert_eq!(
            logins.find("https", "GIT.example.com", None).unwrap(),
            Some(("lee".into(), "token-2".into()))
        );
        assert_eq!(
            logins
                .find("https", "git.example.com", Some("kim"))
                .unwrap(),
            Some(("kim".into(), "token-1".into()))
        );
        assert_eq!(logins.find("http", "git.example.com", None).unwrap(), None);

        // Saving again replaces the secret, not adds a row.
        logins
            .save("https", "git.example.com", "kim", "token-3")
            .unwrap();
        assert_eq!(logins.list().len(), 2);
        assert_eq!(logins.list()[0].username, "kim");

        logins.forget("https", "git.example.com", "kim").unwrap();
        assert_eq!(
            logins
                .find("https", "git.example.com", Some("kim"))
                .unwrap(),
            None
        );
        assert_eq!(vault.get("https://kim@git.example.com").unwrap(), None);

        // The list survives a restart; secrets stay in the vault, not the file.
        let reloaded = store(&dir, vault);
        assert_eq!(reloaded.list().len(), 1);
        let file = std::fs::read_to_string(dir.path().join("logins.json")).unwrap();
        assert!(!file.contains("token"));
    }
}
