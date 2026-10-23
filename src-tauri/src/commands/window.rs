use std::sync::Arc;

use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WebviewWindowBuilder,
    Window,
};

use crate::error::{AppError, AppErrorKind, AppResult, blocking};
use crate::repositories::RepositoryStore;
use crate::windows::{self, Bounds, MAIN_WINDOW, Placement, RepoWindows};

/// How far a new window sits from the one it was opened from, in logical
/// pixels, so it doesn't cover it exactly.
const CASCADE_OFFSET: f64 = 28.0;

/// Label of the settings window; `capabilities/default.json` lists it.
const SETTINGS_WINDOW: &str = "settings";

/// Label of the About window; `capabilities/default.json` lists it.
const ABOUT_WINDOW: &str = "about";

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
    if let Err(e) = build_window(&app, Some(&window), &label) {
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
///
/// Async because creating a window from a synchronous command deadlocks
/// WebView2 on Windows: the window appears but its page never loads.
#[tauri::command]
#[specta::specta]
pub async fn window_open_settings(app: AppHandle) -> AppResult<()> {
    open_single_window(&app, SETTINGS_WINDOW, 680.0, 480.0)
}

/// Opens the About window, or brings it forward if it is already open.
/// Async for the same reason as `window_open_settings`.
#[tauri::command]
#[specta::specta]
pub async fn window_open_about(app: AppHandle) -> AppResult<()> {
    open_single_window(&app, ABOUT_WINDOW, 360.0, 340.0)
}

/// Brings forward the window labeled `label`, or makes it.
fn open_single_window(app: &AppHandle, label: &str, width: f64, height: f64) -> AppResult<()> {
    if let Some(window) = app.get_webview_window(label) {
        // Still hidden if its page never got to show it.
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }
    build_fixed_window(app, label, width, height)
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
fn build_window(
    app: &AppHandle,
    from: Option<&WebviewWindow>,
    label: &str,
) -> tauri::Result<WebviewWindow> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .unwrap_or_default();
    config.label = label.to_owned();
    let mut builder = WebviewWindowBuilder::from_config(app, &config)?;
    if let Some((Ok(position), Ok(scale))) = from.map(|w| (w.outer_position(), w.scale_factor())) {
        let position = position.to_logical::<f64>(scale);
        builder = builder.position(position.x + CASCADE_OFFSET, position.y + CASCADE_OFFSET);
    }
    builder.build()
}

/// Opens the repository windows of the last session where they were. The
/// first takes over the window the app starts with, and the one focused
/// last comes to the front. A window whose repository is gone from the
/// list isn't opened again, except the first, which shows the start
/// screen or the last selected repository instead.
pub fn restore_layout(
    app: &AppHandle,
    windows: &RepoWindows,
    store: &RepositoryStore,
    saved: Vec<Placement>,
) {
    let listed = store.list().repositories;
    let mut front = None;
    for (index, placement) in saved.into_iter().enumerate() {
        let repo = placement.repo.as_ref().filter(|repo| {
            listed.iter().any(|r| &r.path == *repo) && windows.find(repo, None).is_none()
        });
        let window = if index == 0 {
            app.get_webview_window(MAIN_WINDOW)
        } else if let Some(repo) = repo {
            let label = windows.next_label();
            // Set before the window loads: its first `repo_list` reads it.
            windows.set(&label, repo.clone());
            build_window(app, None, &label).ok()
        } else {
            None
        };
        let Some(window) = window else {
            continue;
        };
        if index == 0
            && let Some(repo) = repo
        {
            windows.set(MAIN_WINDOW, repo.clone());
        }
        windows.place(
            window.label(),
            placement.bounds,
            placement.maximized,
            placement.fullscreen,
        );
        place_window(&window, &placement);
        front = Some(window);
    }
    if let Some(window) = front {
        let _ = window.set_focus();
    }
}

fn place_window(window: &WebviewWindow, placement: &Placement) {
    let monitors: Vec<Bounds> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| Bounds {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect();
    if let Some(bounds) = placement
        .bounds
        .filter(|b| windows::reachable(b, &monitors))
    {
        let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
        let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
    }
    if placement.fullscreen {
        let _ = window.set_fullscreen(true);
    } else if placement.maximized {
        let _ = window.maximize();
    }
}

/// Records where `window` sits after it moved or was resized. A minimized
/// window keeps what it had; a maximized or full screen one keeps the
/// bounds from before.
pub fn record_placement(windows: &RepoWindows, window: &Window) {
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let bounds = if maximized || fullscreen {
        None
    } else {
        match (window.outer_position(), window.inner_size()) {
            (Ok(position), Ok(size)) => Some(Bounds {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }),
            _ => None,
        }
    };
    windows.place(window.label(), bounds, maximized, fullscreen);
}

/// A fixed-size window with the same title bar as the repository windows.
/// The page tells it apart by its label, and shows it once it has drawn
/// its first frame so the webview's blank page never flashes.
fn build_fixed_window(app: &AppHandle, label: &str, width: f64, height: f64) -> tauri::Result<()> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .unwrap_or_default();
    config.label = label.to_owned();
    config.width = width;
    config.height = height;
    config.min_width = None;
    config.min_height = None;
    config.resizable = false;
    config.maximizable = false;
    config.minimizable = false;
    config.center = true;
    config.visible = false;
    WebviewWindowBuilder::from_config(app, &config)?.build()?;
    Ok(())
}
