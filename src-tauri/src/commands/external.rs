use std::path::PathBuf;

use crate::error::{AppResult, blocking};
use crate::external::{self, ExternalEditor, ExternalTerminal};

#[tauri::command]
#[specta::specta]
pub async fn external_editors() -> AppResult<Vec<ExternalEditor>> {
    blocking(|| Ok(external::detect_editors())).await
}

/// Editors suited to the kind of project in `path` (Xcode for an iOS app,
/// Android Studio for a Gradle build), whether installed or not.
#[tauri::command]
#[specta::specta]
pub async fn external_suggested_editors(path: String) -> AppResult<Vec<String>> {
    blocking(move || Ok(external::suggested_editors(&PathBuf::from(path)))).await
}

#[tauri::command]
#[specta::specta]
pub async fn external_open_editor(editor_id: String, path: String) -> AppResult<()> {
    blocking(move || external::open_in_editor(&editor_id, &PathBuf::from(path))).await
}

#[tauri::command]
#[specta::specta]
pub async fn external_terminals() -> AppResult<Vec<ExternalTerminal>> {
    blocking(|| Ok(external::detect_terminals())).await
}

/// Opens `path` in `terminal_id`, or the first terminal found.
#[tauri::command]
#[specta::specta]
pub async fn external_open_terminal(path: String, terminal_id: Option<String>) -> AppResult<()> {
    blocking(move || external::open_in_terminal(&PathBuf::from(path), terminal_id.as_deref())).await
}

#[tauri::command]
#[specta::specta]
pub async fn external_reveal(path: String) -> AppResult<()> {
    blocking(move || external::reveal_in_file_manager(&PathBuf::from(path))).await
}
