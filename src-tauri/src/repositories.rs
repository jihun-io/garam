//! The list of repositories the user has added, persisted as JSON in the
//! app data directory.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use garam_git::RepositoryInfo;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const FILE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRepository {
    path: String,
    name: String,
    added_at: f64,
    last_opened_at: Option<f64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct StoreFile {
    version: u32,
    repositories: Vec<StoredRepository>,
    selected: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryEntry {
    pub path: String,
    pub name: String,
    /// Milliseconds since the Unix epoch.
    pub added_at: f64,
    pub last_opened_at: Option<f64>,
    /// The folder no longer exists (moved or deleted outside Garam).
    pub missing: bool,
}

impl From<&StoredRepository> for RepositoryEntry {
    fn from(r: &StoredRepository) -> Self {
        Self {
            path: r.path.clone(),
            name: r.name.clone(),
            added_at: r.added_at,
            last_opened_at: r.last_opened_at,
            missing: !Path::new(&r.path).is_dir(),
        }
    }
}

#[derive(Debug, Serialize, specta::Type)]
pub struct RepositoryList {
    pub repositories: Vec<RepositoryEntry>,
    /// Path of the repository that was open last.
    pub selected: Option<String>,
}

pub struct RepositoryStore {
    file: PathBuf,
    data: Mutex<StoreFile>,
}

impl RepositoryStore {
    /// Loads the store from `file`. A missing file means an empty list. A
    /// corrupt file is moved aside (never silently overwritten) and the
    /// store starts empty.
    pub fn load(file: PathBuf) -> Self {
        let data = match fs::read(&file) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                let backup = file.with_extension(format!("corrupt-{}.json", now_ms() as u64));
                eprintln!(
                    "repository list is unreadable ({err}); moved to {}",
                    backup.display()
                );
                let _ = fs::rename(&file, &backup);
                StoreFile::default()
            }),
            Err(_) => StoreFile::default(),
        };
        Self {
            file,
            data: Mutex::new(data),
        }
    }

    pub fn list(&self) -> RepositoryList {
        let data = self.lock();
        RepositoryList {
            repositories: data.repositories.iter().map(Into::into).collect(),
            selected: data.selected.clone(),
        }
    }

    /// Adds a repository (or refreshes an existing one with the same path)
    /// and selects it.
    pub fn add(&self, info: RepositoryInfo) -> AppResult<RepositoryEntry> {
        let mut data = self.lock();
        let now = now_ms();
        let entry = match data.repositories.iter_mut().find(|r| r.path == info.path) {
            Some(existing) => {
                existing.name = info.name;
                existing.last_opened_at = Some(now);
                RepositoryEntry::from(&*existing)
            }
            None => {
                let stored = StoredRepository {
                    path: info.path,
                    name: info.name,
                    added_at: now,
                    last_opened_at: Some(now),
                };
                let entry = RepositoryEntry::from(&stored);
                data.repositories.push(stored);
                entry
            }
        };
        data.selected = Some(entry.path.clone());
        self.save(&mut data)?;
        Ok(entry)
    }

    /// Removes a repository from the list. Never touches files on disk.
    pub fn remove(&self, path: &str) -> AppResult<()> {
        let mut data = self.lock();
        data.repositories.retain(|r| r.path != path);
        if data.selected.as_deref() == Some(path) {
            data.selected = None;
        }
        self.save(&mut data)
    }

    pub fn select(&self, path: &str) -> AppResult<()> {
        let mut data = self.lock();
        let Some(repo) = data.repositories.iter_mut().find(|r| r.path == path) else {
            return Ok(());
        };
        repo.last_opened_at = Some(now_ms());
        data.selected = Some(path.to_owned());
        self.save(&mut data)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, StoreFile> {
        self.data.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Writes atomically: to a temp file next to the target, then renames.
    fn save(&self, data: &mut StoreFile) -> AppResult<()> {
        data.version = FILE_VERSION;
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(AppError::storage)?;
        }
        let json = serde_json::to_vec_pretty(&*data).map_err(AppError::storage)?;
        let tmp = self.file.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(AppError::storage)?;
        fs::rename(&tmp, &self.file).map_err(AppError::storage)
    }
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(path: &Path) -> RepositoryInfo {
        RepositoryInfo {
            path: path.display().to_string(),
            name: path.file_name().unwrap().to_string_lossy().into_owned(),
        }
    }

    #[test]
    fn persists_adds_and_removals() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("repositories.json");
        let repo_a = dir.path().join("a");
        let repo_b = dir.path().join("b");
        fs::create_dir(&repo_a).unwrap();

        let store = RepositoryStore::load(file.clone());
        store.add(info(&repo_a)).unwrap();
        store.add(info(&repo_b)).unwrap();
        store.remove(&repo_b.display().to_string()).unwrap();

        let reloaded = RepositoryStore::load(file).list();
        assert_eq!(reloaded.repositories.len(), 1);
        assert_eq!(reloaded.repositories[0].name, "a");
        assert!(!reloaded.repositories[0].missing);
        // Removing the selected repository clears the selection.
        assert_eq!(reloaded.selected, None);
    }

    #[test]
    fn adding_twice_keeps_one_entry_and_selects_it() {
        let dir = tempfile::tempdir().unwrap();
        let store = RepositoryStore::load(dir.path().join("r.json"));
        let repo = dir.path().join("repo");
        store.add(info(&repo)).unwrap();
        store.add(info(&repo)).unwrap();
        let list = store.list();
        assert_eq!(list.repositories.len(), 1);
        assert_eq!(list.selected, Some(repo.display().to_string()));
        assert!(list.repositories[0].missing, "folder was never created");
    }

    #[test]
    fn corrupt_file_is_moved_aside() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("repositories.json");
        fs::write(&file, "{ not json").unwrap();

        let store = RepositoryStore::load(file.clone());
        assert!(store.list().repositories.is_empty());
        assert!(!file.exists());
        let backups = fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(backups, 1);
    }
}
