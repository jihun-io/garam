//! App settings, persisted as `settings.json` in the app data folder.
//!
//! Git settings (author, default branch) are not here: they live in git's
//! own config, see `garam_git::config`.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::storage;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum Accent {
    Garam,
    Blue,
    Purple,
    Pink,
    Orange,
    /// The operating system's accent color, where it can be read (Garam
    /// green where it can't).
    #[default]
    System,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum DiffFontSize {
    Small,
    #[default]
    Medium,
    Large,
}

/// Where a repository chosen from another one's window opens.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum OpenRepositoryIn {
    #[default]
    Ask,
    CurrentWindow,
    NewWindow,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// UI language code; `None` follows the system language.
    pub language: Option<String>,
    pub theme: Theme,
    pub accent: Accent,
    pub diff_font_size: DiffFontSize,
    /// Preferred editor id; `None` uses the first one found.
    pub editor: Option<String>,
    /// Preferred terminal id; `None` uses the first one found.
    pub terminal: Option<String>,
    /// Minutes between background fetches; 0 turns them off.
    pub fetch_interval_minutes: u32,
    /// Width of the changes/history sidebar in CSS pixels.
    pub sidebar_width: u32,
    pub open_repository_in: OpenRepositoryIn,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: None,
            theme: Theme::default(),
            accent: Accent::default(),
            diff_font_size: DiffFontSize::default(),
            editor: None,
            terminal: None,
            fetch_interval_minutes: 5,
            sidebar_width: 320,
            open_repository_in: OpenRepositoryIn::default(),
        }
    }
}

pub struct SettingsStore {
    file: PathBuf,
    data: Mutex<AppSettings>,
    launch_language: Option<String>,
}

impl SettingsStore {
    /// Loads `file`. Fields missing from it (an older version, or a field
    /// added since) take their defaults; a value that no longer parses
    /// resets everything to defaults.
    pub fn load(file: PathBuf) -> Self {
        let stored: serde_json::Value = storage::load(&file);
        let mut merged = serde_json::to_value(AppSettings::default()).unwrap_or_default();
        if let (Some(merged), serde_json::Value::Object(stored)) = (merged.as_object_mut(), stored)
        {
            merged.extend(stored);
        }
        let data: AppSettings = serde_json::from_value(merged).unwrap_or_default();
        Self {
            file,
            launch_language: data.language.clone(),
            data: Mutex::new(data),
        }
    }

    /// The language setting when the app started; macOS's own menus keep
    /// it until the next launch.
    pub fn launch_language(&self) -> Option<String> {
        self.launch_language.clone()
    }

    pub fn get(&self) -> AppSettings {
        self.lock().clone()
    }

    /// Replaces all settings and saves them.
    pub fn set(&self, settings: AppSettings) -> AppResult<()> {
        let mut data = self.lock();
        storage::save(&self.file, &settings)?;
        *data = settings;
        Ok(())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, AppSettings> {
        self.data.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn saves_and_reloads() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        let store = SettingsStore::load(file.clone());
        assert_eq!(store.get(), AppSettings::default());

        let changed = AppSettings {
            language: Some("ko".into()),
            theme: Theme::Dark,
            accent: Accent::Purple,
            fetch_interval_minutes: 0,
            sidebar_width: 400,
            open_repository_in: OpenRepositoryIn::NewWindow,
            ..AppSettings::default()
        };
        store.set(changed.clone()).unwrap();
        assert_eq!(SettingsStore::load(file).get(), changed);
    }

    #[test]
    fn keeps_the_language_it_started_with() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        fs::write(&file, r#"{ "language": "en" }"#).unwrap();
        let store = SettingsStore::load(file);
        store
            .set(AppSettings {
                language: Some("ko".into()),
                ..store.get()
            })
            .unwrap();
        assert_eq!(store.get().language.as_deref(), Some("ko"));
        assert_eq!(store.launch_language().as_deref(), Some("en"));
    }

    #[test]
    fn fills_in_missing_fields() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        fs::write(&file, r#"{ "theme": "light" }"#).unwrap();
        let settings = SettingsStore::load(file).get();
        assert_eq!(settings.theme, Theme::Light);
        assert_eq!(settings.fetch_interval_minutes, 5);
    }
}
