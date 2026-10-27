//! App updates from GitHub Releases, through `tauri-plugin-updater`.
//!
//! The release workflow publishes `latest.json` with a signed installer
//! per platform. One check runs shortly after launch and then every few
//! hours (unless turned off in settings); the menu can check any time.
//! The state lives here rather than in a window so every window shows the
//! same update, and [`UPDATE_CHANGED_EVENT`] tells them when it changes.

use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{AppError, AppErrorKind, AppResult};
use crate::settings::SettingsStore;

/// Emitted to every window when [`UpdateStatus`] changes.
pub const UPDATE_CHANGED_EVENT: &str = "update-changed";

/// Leaves launch to the repository and the window before going online.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(10);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// A newer version, unless the user said "later" to it.
    pub available: Option<UpdateInfo>,
    /// Downloading or installing in some window.
    pub installing: bool,
    /// Installed; takes effect after a restart.
    pub installed: bool,
}

/// Download progress, for the window that started the install.
#[derive(Debug, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    // Bytes; u32 because specta won't export u64, and installers are far
    // below 4 GiB.
    pub downloaded: u32,
    pub total: Option<u32>,
}

#[derive(Default)]
struct State {
    update: Option<Update>,
    /// The version the user postponed; a newer one shows again.
    dismissed: Option<String>,
    installing: bool,
    installed: bool,
}

#[derive(Default)]
pub struct Updates {
    state: Mutex<State>,
}

impl Updates {
    pub fn status(&self) -> UpdateStatus {
        let state = self.lock();
        UpdateStatus {
            available: state
                .update
                .as_ref()
                .filter(|u| state.dismissed.as_deref() != Some(u.version.as_str()))
                .map(info),
            installing: state.installing,
            installed: state.installed,
        }
    }

    /// Asks the release feed for a newer version. An explicit check shows
    /// a postponed version again.
    pub async fn check(&self, app: &AppHandle, explicit: bool) -> AppResult<Option<UpdateInfo>> {
        if app.config().identifier != "io.jihun.garam" {
            return Ok(None);
        }
        let update = app
            .updater()
            .map_err(check_failed)?
            .check()
            .await
            .map_err(check_failed)?;
        let found = update.as_ref().map(info);
        {
            let mut state = self.lock();
            if state.installing || state.installed {
                return Ok(found);
            }
            if explicit {
                state.dismissed = None;
            }
            state.update = update;
        }
        self.changed(app);
        Ok(found)
    }

    pub fn dismiss(&self, app: &AppHandle) {
        {
            let mut state = self.lock();
            state.dismissed = state.update.as_ref().map(|u| u.version.clone());
        }
        self.changed(app);
    }

    /// Downloads and installs the available update. On Windows the
    /// installer closes the app itself; elsewhere it takes effect after
    /// `app_restart`.
    pub async fn install(
        &self,
        app: &AppHandle,
        on_progress: impl Fn(UpdateProgress),
    ) -> AppResult<()> {
        if app.config().identifier != "io.jihun.garam" {
            return Ok(());
        }
        let update = {
            let mut state = self.lock();
            if state.installing || state.installed {
                return Ok(());
            }
            let Some(update) = state.update.clone() else {
                return Ok(());
            };
            state.installing = true;
            update
        };
        self.changed(app);

        let mut downloaded = 0u32;
        let result = update
            .download_and_install(
                |chunk, total| {
                    downloaded =
                        downloaded.saturating_add(u32::try_from(chunk).unwrap_or(u32::MAX));
                    on_progress(UpdateProgress {
                        downloaded,
                        total: total.map(|t| u32::try_from(t).unwrap_or(u32::MAX)),
                    });
                },
                || {},
            )
            .await;
        {
            let mut state = self.lock();
            state.installing = false;
            state.installed = result.is_ok();
        }
        self.changed(app);
        result.map_err(|e| AppError::app(AppErrorKind::UpdateInstallFailed, Some(e.to_string())))
    }

    fn changed(&self, app: &AppHandle) {
        let _ = app.emit(UPDATE_CHANGED_EVENT, self.status());
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn info(update: &Update) -> UpdateInfo {
    UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
    }
}

fn check_failed(err: tauri_plugin_updater::Error) -> AppError {
    AppError::app(AppErrorKind::UpdateCheckFailed, Some(err.to_string()))
}

/// Checks in the background while the setting allows it. Development
/// apps never check; debug builds of the release app only check manually.
pub fn start_background_checks(app: AppHandle) {
    if cfg!(debug_assertions) || app.config().identifier != "io.jihun.garam" {
        return;
    }
    thread::spawn(move || {
        thread::sleep(FIRST_CHECK_DELAY);
        loop {
            let enabled = app.state::<Arc<SettingsStore>>().get().check_for_updates;
            if enabled {
                let updates = app.state::<Arc<Updates>>();
                // A failed background check stays quiet; the next one retries.
                let _ = tauri::async_runtime::block_on(updates.check(&app, false));
            }
            thread::sleep(CHECK_INTERVAL);
        }
    });
}
