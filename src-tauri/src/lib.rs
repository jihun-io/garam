mod commands;
mod error;
mod external;
mod operations;
mod repositories;

use std::sync::Arc;

use tauri::Manager;
use tauri_specta::{Builder, collect_commands};

use crate::operations::Operations;
use crate::repositories::RepositoryStore;

/// Single source of truth for the IPC surface. Also used by the
/// `export_bindings` test to regenerate `src/ipc/bindings.ts`.
pub fn specta_builder() -> Builder<tauri::Wry> {
    use commands::{external, git, repo};
    Builder::<tauri::Wry>::new().commands(collect_commands![
        git::git_info,
        repo::repo_list,
        repo::repo_add,
        repo::repo_init_existing,
        repo::repo_create,
        repo::repo_clone,
        repo::repo_remove,
        repo::repo_select,
        repo::operation_cancel,
        external::external_editors,
        external::external_open_editor,
        external::external_open_terminal,
        external::external_reveal,
    ])
}

pub const BINDINGS_PATH: &str = "../src/ipc/bindings.ts";

pub fn export_bindings(builder: &Builder<tauri::Wry>) {
    builder
        .export(specta_typescript::Typescript::default(), BINDINGS_PATH)
        .expect("failed to export TypeScript bindings");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    #[cfg(debug_assertions)]
    export_bindings(&builder);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            let data_dir = app.path().app_data_dir()?;
            app.manage(Arc::new(RepositoryStore::load(
                data_dir.join("repositories.json"),
            )));
            app.manage(Arc::new(Operations::default()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn export_bindings() {
        super::export_bindings(&super::specta_builder());
    }
}
