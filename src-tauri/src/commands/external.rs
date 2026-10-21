use std::path::PathBuf;

use crate::error::{AppResult, blocking};
use crate::external::{self, ExternalEditor};

#[tauri::command]
#[specta::specta]
pub async fn external_editors() -> AppResult<Vec<ExternalEditor>> {
    blocking(|| Ok(external::detect_editors())).await
}

#[tauri::command]
#[specta::specta]
pub async fn external_open_editor(editor_id: String, path: String) -> AppResult<()> {
    blocking(move || external::open_in_editor(&editor_id, &PathBuf::from(path))).await
}

#[tauri::command]
#[specta::specta]
pub async fn external_open_terminal(path: String) -> AppResult<()> {
    blocking(move || external::open_in_terminal(&PathBuf::from(path))).await
}

#[tauri::command]
#[specta::specta]
pub async fn external_reveal(path: String) -> AppResult<()> {
    blocking(move || external::reveal_in_file_manager(&PathBuf::from(path))).await
}
