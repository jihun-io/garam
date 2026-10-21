mod commands;
mod error;

use tauri_specta::{Builder, collect_commands};

/// Single source of truth for the IPC surface. Also used by the
/// `export_bindings` test to regenerate `src/ipc/bindings.ts`.
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![commands::git::git_info])
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
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
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
