use std::sync::Arc;

use garam_git::Git;
use garam_git::config::{self, GlobalKey, GlobalSettings};
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppResult, blocking};
use crate::settings::{AppSettings, SettingsStore};

type Store<'a> = State<'a, Arc<SettingsStore>>;

#[tauri::command]
#[specta::specta]
pub fn settings_get(store: Store<'_>) -> AppSettings {
    store.get()
}

#[tauri::command]
#[specta::specta]
pub async fn settings_set(
    app: AppHandle,
    store: Store<'_>,
    settings: AppSettings,
) -> AppResult<()> {
    let store = Arc::clone(&store);
    let identifier = app.config().identifier.clone();
    let changed = settings.clone();
    blocking(move || {
        // macOS's own menu items take the language at the next launch.
        if store.get().language != settings.language {
            crate::locale::sync(&identifier, settings.language.as_deref());
        }
        store.set(settings)
    })
    .await?;
    // Other windows apply the change too.
    let _ = app.emit(SETTINGS_CHANGED_EVENT, changed);
    Ok(())
}

pub const SETTINGS_CHANGED_EVENT: &str = "settings-changed";

/// Quits and starts the app again, e.g. so macOS's own menus pick up a new
/// language.
#[tauri::command]
#[specta::specta]
pub fn app_restart(app: AppHandle) {
    app.restart();
}

/// The operating system's accent color as `#rrggbb`, if it can be read.
#[tauri::command]
#[specta::specta]
pub async fn system_accent_color() -> AppResult<Option<String>> {
    blocking(|| Ok(crate::system::accent_color())).await
}

#[tauri::command]
#[specta::specta]
pub async fn git_global_get() -> AppResult<GlobalSettings> {
    blocking(|| Ok(config::global_settings(&Git::locate()?)?)).await
}

/// Sets a global git setting; an empty value removes it.
#[tauri::command]
#[specta::specta]
pub async fn git_global_set(key: GlobalKey, value: String) -> AppResult<()> {
    blocking(move || Ok(config::set(&Git::locate()?, key, &value)?)).await
}
