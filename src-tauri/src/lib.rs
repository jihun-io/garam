mod askpass;
mod commands;
mod error;
mod external;
mod locale;
mod operations;
mod repositories;
mod settings;
mod storage;
mod system;
mod watcher;

use std::sync::Arc;

use tauri::Manager;
use tauri_specta::{Builder, collect_commands};

use crate::operations::Operations;
use crate::repositories::RepositoryStore;

/// Single source of truth for the IPC surface. Also used by the
/// `export_bindings` test to regenerate `src/ipc/bindings.ts`.
pub fn specta_builder() -> Builder<tauri::Wry> {
    use commands::{branches, changes, conflicts, external, git, history, remote, repo, settings};
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
        repo::repo_watch,
        changes::status_get,
        changes::diff_get,
        changes::diff_images,
        changes::changes_stage,
        changes::changes_unstage,
        changes::changes_stage_lines,
        changes::changes_discard,
        changes::commit_create,
        changes::commit_head,
        changes::identity_get,
        changes::identity_set,
        branches::branch_list,
        branches::branch_create,
        branches::branch_switch,
        branches::branch_rename,
        branches::branch_delete,
        branches::branch_merge_preview,
        branches::branch_merge,
        branches::stash_find_auto,
        branches::stash_pop,
        branches::stash_drop,
        conflicts::conflict_state,
        conflicts::conflict_resolve,
        conflicts::conflict_mark_resolved,
        conflicts::conflict_continue,
        conflicts::conflict_abort,
        history::history_list,
        history::commit_detail,
        history::commit_file_diff,
        history::commit_revert,
        remote::remote_info,
        remote::remote_fetch,
        remote::remote_pull,
        remote::remote_push,
        remote::remote_publish,
        remote::credential_respond,
        settings::settings_get,
        settings::settings_set,
        settings::system_accent_color,
        settings::git_global_get,
        settings::git_global_set,
        settings::app_restart,
        external::external_editors,
        external::external_terminals,
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

/// When git or ssh started this process as its askpass program, answers
/// the prompt and returns the exit code instead of starting the app.
pub fn run_askpass_helper() -> Option<i32> {
    askpass::run_helper_if_requested()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();
    let context = tauri::generate_context!();

    // Before the app starts: AppKit reads the language only at launch.
    #[cfg(target_os = "macos")]
    if let Some(dir) = locale::macos_data_dir(&context.config().identifier) {
        let language = settings::SettingsStore::load(dir.join("settings.json"))
            .get()
            .language;
        locale::sync(&context.config().identifier, language.as_deref());
    }

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
            app.manage(Arc::new(settings::SettingsStore::load(
                data_dir.join("settings.json"),
            )));
            app.manage(Arc::new(Operations::default()));
            app.manage(Arc::new(askpass::Askpass::start()));
            app.manage(watcher::RepoWatcher::default());
            Ok(())
        })
        .run(context)
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn export_bindings() {
        super::export_bindings(&super::specta_builder());
    }
}
