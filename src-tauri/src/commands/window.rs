use std::sync::Arc;

use tauri::{AppHandle, Manager, State, WebviewWindow, WebviewWindowBuilder};

use crate::error::{AppError, AppErrorKind, AppResult, blocking};
use crate::repositories::RepositoryStore;
use crate::windows::RepoWindows;

/// How far a new window sits from the one it was opened from, in logical
/// pixels, so it doesn't cover it exactly.
const CASCADE_OFFSET: f64 = 28.0;

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
