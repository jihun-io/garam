//! Signed-in GitHub accounts.
//!
//! Account details (login, name, emails) live in `accounts.json`; each
//! account's token lives in the OS keychain and never leaves the backend.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use garam_github::{Email, User};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppErrorKind, AppResult};
use crate::storage;

/// Keychain service name for Garam's GitHub tokens.
pub const KEYCHAIN_SERVICE: &str = "io.jihun.garam.github";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// `<host>/<user id>`: the ID stays the same when the login is renamed.
    pub key: String,
    pub host: String,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
    /// Verified addresses, primary first.
    pub emails: Vec<String>,
    /// GitHub's private `…@users.noreply.github.com` address.
    pub noreply_email: String,
}

impl Account {
    pub fn new(host: &str, user: &User, emails: &[Email]) -> Self {
        let mut verified: Vec<&Email> = emails.iter().filter(|e| e.verified).collect();
        verified.sort_by_key(|e| !e.primary);
        Self {
            key: format!("{host}/{}", user.id),
            host: host.to_owned(),
            login: user.login.clone(),
            name: user.name.clone().filter(|n| !n.trim().is_empty()),
            avatar_url: user.avatar_url.clone(),
            emails: verified.into_iter().map(|e| e.email.clone()).collect(),
            noreply_email: user.noreply_email(host),
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AccountFile {
    accounts: Vec<Account>,
}

/// Where tokens are kept; the OS keychain in the app, memory in tests.
pub trait TokenVault: Send + Sync {
    fn set(&self, key: &str, token: &str) -> AppResult<()>;
    fn get(&self, key: &str) -> AppResult<Option<String>>;
    fn delete(&self, key: &str) -> AppResult<()>;
}

/// The OS keychain, under one service name.
pub struct Keychain(pub &'static str);

impl Keychain {
    fn entry(&self, key: &str) -> AppResult<keyring::Entry> {
        keyring::Entry::new(self.0, key).map_err(keychain_error)
    }
}

impl TokenVault for Keychain {
    fn set(&self, key: &str, token: &str) -> AppResult<()> {
        self.entry(key)?.set_password(token).map_err(keychain_error)
    }

    fn get(&self, key: &str) -> AppResult<Option<String>> {
        match self.entry(key)?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(keychain_error(e)),
        }
    }

    fn delete(&self, key: &str) -> AppResult<()> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keychain_error(e)),
        }
    }
}

fn keychain_error(err: keyring::Error) -> AppError {
    AppError::app(AppErrorKind::KeychainFailed, Some(err.to_string()))
}

pub struct AccountStore {
    file: PathBuf,
    accounts: Mutex<Vec<Account>>,
    vault: Box<dyn TokenVault>,
    /// Tokens already read this run. macOS may ask the user before each
    /// keychain read by a binary it doesn't recognize (every development
    /// rebuild), so read each token at most once.
    tokens: Mutex<HashMap<String, String>>,
}

impl AccountStore {
    pub fn load(file: PathBuf, vault: Box<dyn TokenVault>) -> Self {
        let stored: AccountFile = storage::load(&file);
        Self {
            file,
            accounts: Mutex::new(stored.accounts),
            vault,
            tokens: Mutex::default(),
        }
    }

    pub fn list(&self) -> Vec<Account> {
        self.lock().clone()
    }

    /// Adds the account, or updates it when it was signed in before. The
    /// token is saved first so a listed account always has one.
    pub fn save(&self, account: Account, token: &str) -> AppResult<()> {
        self.vault.set(&account.key, token)?;
        self.cached_tokens()
            .insert(account.key.clone(), token.to_owned());
        let mut accounts = self.lock();
        let mut next = accounts.clone();
        match next.iter_mut().find(|a| a.key == account.key) {
            Some(existing) => *existing = account,
            None => next.push(account),
        }
        storage::save(
            &self.file,
            &AccountFile {
                accounts: next.clone(),
            },
        )?;
        *accounts = next;
        Ok(())
    }

    /// Signs out: forgets the account and deletes its token.
    pub fn remove(&self, key: &str) -> AppResult<()> {
        let mut accounts = self.lock();
        let next: Vec<Account> = accounts.iter().filter(|a| a.key != key).cloned().collect();
        storage::save(
            &self.file,
            &AccountFile {
                accounts: next.clone(),
            },
        )?;
        *accounts = next;
        drop(accounts);
        self.cached_tokens().remove(key);
        self.vault.delete(key)
    }

    pub fn get(&self, key: &str) -> Option<Account> {
        self.lock().iter().find(|a| a.key == key).cloned()
    }

    /// The account's token, for git and API calls made by the backend.
    pub fn token(&self, key: &str) -> AppResult<Option<String>> {
        if let Some(token) = self.cached_tokens().get(key) {
            return Ok(Some(token.clone()));
        }
        let token = self.vault.get(key)?;
        if let Some(token) = &token {
            self.cached_tokens().insert(key.to_owned(), token.clone());
        }
        Ok(token)
    }

    fn cached_tokens(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.tokens.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Account>> {
        self.accounts.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
pub mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use super::*;

    /// Keeps tokens in memory; clones share them.
    #[derive(Clone, Default)]
    pub struct MemoryVault(Arc<Mutex<HashMap<String, String>>>);

    impl TokenVault for MemoryVault {
        fn set(&self, key: &str, token: &str) -> AppResult<()> {
            self.0.lock().unwrap().insert(key.into(), token.into());
            Ok(())
        }
        fn get(&self, key: &str) -> AppResult<Option<String>> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }
        fn delete(&self, key: &str) -> AppResult<()> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }

    fn user(id: u64, login: &str) -> User {
        User {
            id,
            login: login.into(),
            name: Some("김지훈".into()),
            avatar_url: format!("https://avatars.githubusercontent.com/u/{id}"),
        }
    }

    fn email(email: &str, primary: bool, verified: bool) -> Email {
        Email {
            email: email.into(),
            primary,
            verified,
        }
    }

    /// Counts reads, to check the store doesn't ask the keychain again.
    #[derive(Clone, Default)]
    struct CountingVault {
        inner: MemoryVault,
        reads: Arc<Mutex<usize>>,
    }

    impl TokenVault for CountingVault {
        fn set(&self, key: &str, token: &str) -> AppResult<()> {
            self.inner.set(key, token)
        }
        fn get(&self, key: &str) -> AppResult<Option<String>> {
            *self.reads.lock().unwrap() += 1;
            self.inner.get(key)
        }
        fn delete(&self, key: &str) -> AppResult<()> {
            self.inner.delete(key)
        }
    }

    #[test]
    fn reads_each_token_from_the_vault_once() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("accounts.json");
        let vault = CountingVault::default();
        vault.inner.set("github.com/1", "gho_saved").unwrap();
        AccountStore::load(file.clone(), Box::new(vault.clone()))
            .save(
                Account::new("github.com", &user(1, "jihun-io"), &[]),
                "gho_saved",
            )
            .unwrap();

        // A new run reads the keychain once, then answers from memory.
        let store = AccountStore::load(file, Box::new(vault.clone()));
        for _ in 0..3 {
            assert_eq!(
                store.token("github.com/1").unwrap().as_deref(),
                Some("gho_saved")
            );
        }
        assert_eq!(*vault.reads.lock().unwrap(), 1);

        // Signing in again doesn't need a read, and signing out forgets it.
        store
            .save(Account::new("github.com", &user(2, "cw"), &[]), "gho_work")
            .unwrap();
        assert_eq!(
            store.token("github.com/2").unwrap().as_deref(),
            Some("gho_work")
        );
        assert_eq!(*vault.reads.lock().unwrap(), 1);
        store.remove("github.com/1").unwrap();
        assert_eq!(store.token("github.com/1").unwrap(), None);
    }

    #[test]
    fn keeps_verified_emails_primary_first() {
        let account = Account::new(
            "github.com",
            &user(1, "jihun-io"),
            &[
                email("other@example.com", false, true),
                email("unverified@example.com", false, false),
                email("kim@jihun.io", true, true),
            ],
        );
        assert_eq!(account.key, "github.com/1");
        assert_eq!(account.emails, ["kim@jihun.io", "other@example.com"]);
        assert_eq!(account.noreply_email, "1+jihun-io@users.noreply.github.com");
    }

    #[test]
    fn saves_updates_and_removes_accounts() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("accounts.json");
        let vault = MemoryVault::default();
        let store = AccountStore::load(file.clone(), Box::new(vault.clone()));

        let personal = Account::new("github.com", &user(1, "jihun-io"), &[]);
        let work = Account::new("github.com", &user(2, "cw-jihun-io"), &[]);
        store.save(personal.clone(), "gho_personal").unwrap();
        store.save(work.clone(), "gho_work").unwrap();

        // Signing in again (e.g. after a rename) replaces, not duplicates.
        let renamed = Account::new("github.com", &user(1, "jihun"), &[]);
        store.save(renamed, "gho_personal2").unwrap();

        let reloaded = AccountStore::load(file.clone(), Box::new(vault.clone()));
        let logins: Vec<_> = reloaded.list().into_iter().map(|a| a.login).collect();
        assert_eq!(logins, ["jihun", "cw-jihun-io"]);
        assert_eq!(
            reloaded.token("github.com/1").unwrap().as_deref(),
            Some("gho_personal2")
        );

        reloaded.remove(&work.key).unwrap();
        assert_eq!(reloaded.list().len(), 1);
        assert_eq!(reloaded.token(&work.key).unwrap(), None);
        // The token is never written to the file.
        let json = std::fs::read_to_string(&file).unwrap();
        assert!(!json.contains("gho_"));
    }
}
