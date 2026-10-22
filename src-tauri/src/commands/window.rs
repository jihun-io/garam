use std::sync::Arc;

use tauri::{AppHandle, Manager, State, WebviewWindow, WebviewWindowBuilder};

use crate::error::{AppError, AppErrorKind, AppResult, blocking};
use crate::repositories::RepositoryStore;
use crate::windows::RepoWindows;

/// How far a new window sits from the one it was opened from, in logical
/// pixels, so it doesn't cover it exactly.
const CASCADE_OFFSET: f64 = 28.0;

/// Label of the settings window; `capabilities/default.json` lists it.
const SETTINGS_WINDOW: &str = "settings";

/// Brings forward the window, other than the calling one, that shows
/// `path`. Returns whether there was one.
#[tauri::command]
#[specta::specta]
pub fn window_focus_repo(
    app: AppHandle,
    window: WebviewWindow,
    windows: State<'_, Arc<RepoWindows>>,
    path: String,
) -> bool {
    focus_window_showing(&app, &windows, &path, Some(window.label()))
}

/// Opens `path` in a new window, or brings forward the window already
/// showing it.
#[tauri::command]
#[specta::specta]
pub async fn window_open(
    app: AppHandle,
    window: WebviewWindow,
    windows: State<'_, Arc<RepoWindows>>,
    store: State<'_, Arc<RepositoryStore>>,
    path: String,
) -> AppResult<()> {
    if focus_window_showing(&app, &windows, &path, None) {
        return Ok(());
    }
    let label = windows.next_label();
    // Set before the window loads: its first `repo_list` reads it.
    windows.set(&label, path.clone());
    if let Err(e) = build_window(&app, &window, &label) {
        windows.remove(&label);
        return Err(AppError::app(
            AppErrorKind::WindowFailed,
            Some(e.to_string()),
        ));
    }
    let store = Arc::clone(&store);
    blocking(move || store.select(&path)).await
}

/// Opens the settings window, or brings it forward if it is already open.
/// There is one for the whole app.
#[tauri::command]
#[specta::specta]
pub fn window_open_settings(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }
    build_settings_window(&app)
        .map_err(|e| AppError::app(AppErrorKind::WindowFailed, Some(e.to_string())))
}

fn focus_window_showing(
    app: &AppHandle,
    windows: &RepoWindows,
    path: &str,
    except: Option<&str>,
) -> bool {
    let Some(target) = windows
        .find(path, except)
        .and_then(|label| app.get_webview_window(&label))
    else {
        return false;
    };
    let _ = target.unminimize();
    let _ = target.set_focus();
    true
}

/// A window like the first one, a little below and right of `from`.
fn build_window(app: &AppHandle, from: &WebviewWindow, label: &str) -> tauri::Result<()> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .unwrap_or_default();
    config.label = label.to_owned();
    let mut builder = WebviewWindowBuilder::from_config(app, &config)?;
    if let (Ok(position), Ok(scale)) = (from.outer_position(), from.scale_factor()) {
        let position = position.to_logical::<f64>(scale);
        builder = builder.position(position.x + CASCADE_OFFSET, position.y + CASCADE_OFFSET);
    }
    builder.build()?;
    Ok(())
}

/// A fixed-size window with the same title bar as the repository windows.
/// The page tells it apart by its label.
fn build_settings_window(app: &AppHandle) -> tauri::Result<()> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .unwrap_or_default();
    config.label = SETTINGS_WINDOW.to_owned();
    config.width = 680.0;
    config.height = 480.0;
    config.min_width = None;
    config.min_height = None;
    config.resizable = false;
    config.maximizable = false;
    config.minimizable = false;
    config.center = true;
    WebviewWindowBuilder::from_config(app, &config)?.build()?;
    Ok(())
}
