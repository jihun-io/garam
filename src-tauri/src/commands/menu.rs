use tauri::{LogicalPosition, Manager, Webview, Window, menu::Menu};

use crate::error::{AppError, AppErrorKind, AppResult};

/// Show a frontend-created menu without holding the webview's resource lock.
/// Tauri's built-in popup command keeps that lock while AppKit runs its nested
/// menu event loop. A concurrent menu update then deadlocks the main thread.
#[tauri::command]
#[specta::specta]
pub async fn context_menu_popup(
    webview: Webview,
    window: Window,
    rid: u32,
    x: f64,
    y: f64,
) -> AppResult<()> {
    let menu = {
        let resources = webview.resources_table();
        resources.get::<Menu<tauri::Wry>>(rid).map_err(menu_error)?
    };
    window
        .popup_menu_at(menu.as_ref(), LogicalPosition::new(x, y))
        .map_err(menu_error)
}

fn menu_error(error: tauri::Error) -> AppError {
    AppError::app(AppErrorKind::MenuFailed, Some(error.to_string()))
}
