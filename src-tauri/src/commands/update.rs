use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::updater::{UpdateInfo, UpdateProgress, UpdateStatus, Updates};

type Store<'a> = State<'a, Arc<Updates>>;

#[tauri::command]
#[specta::specta]
pub fn update_status(updates: Store<'_>) -> UpdateStatus {
    updates.status()
}

/// Checks for a newer version now (the menu's "Check for Updates").
#[tauri::command]
#[specta::specta]
pub async fn update_check(app: AppHandle, updates: Store<'_>) -> AppResult<Option<UpdateInfo>> {
    updates.check(&app, true).await
}

/// Hides the available version until a newer one comes out.
#[tauri::command]
#[specta::specta]
pub fn update_dismiss(app: AppHandle, updates: Store<'_>) {
    updates.dismiss(&app);
}

#[tauri::command]
#[specta::specta]
pub async fn update_install(
    app: AppHandle,
    updates: Store<'_>,
    on_progress: Channel<UpdateProgress>,
) -> AppResult<()> {
    updates
        .install(&app, |progress| {
            let _ = on_progress.send(progress);
        })
        .await
}
