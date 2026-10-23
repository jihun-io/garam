mod accounts;
mod askpass;
mod commands;
mod error;
mod external;
mod locale;
mod logins;
mod operations;
mod relaunch;
mod repositories;
mod settings;
mod storage;
mod system;
mod updater;
mod watcher;
mod windows;

use std::sync::Arc;

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_specta::{Builder, collect_commands};

use crate::operations::Operations;
use crate::repositories::RepositoryStore;

/// Single source of truth for the IPC surface. Also used by the
/// `export_bindings` test to regenerate `src/ipc/bindings.ts`.
pub fn specta_builder() -> Builder<tauri::Wry> {
    use commands::{
        branches, changes, conflicts, external, git, github, history, pull_requests, remote, repo,
        settings, stashes, update, window,
    };
    Builder::<tauri::Wry>::new().commands(collect_commands![
        git::git_info,
        repo::repo_list,
        repo::repo_add,
        repo::repo_init_existing,
        repo::repo_create,
        repo::repo_clone,
        repo::repo_remove,
        repo::repo_select,
        repo::repo_set_account,
        repo::operation_cancel,
        repo::repo_watch,
        window::window_focus_repo,
        window::window_open,
        window::window_open_settings,
        window::window_open_about,
        changes::status_get,
        changes::diff_get,
        changes::diff_images,
        changes::changes_stage,
        changes::changes_unstage,
        changes::changes_stage_lines,
        changes::changes_discard,
        changes::commit_create,
        changes::commit_check,
        changes::commit_ignore,
        changes::commit_head,
        changes::identity_get,
        changes::identity_set,
        changes::identity_set_local,
        changes::identity_clear_local,
        branches::branch_list,
        branches::branch_create,
        branches::branch_switch,
        branches::branch_rename,
        branches::branch_delete,
        branches::branch_merge_preview,
        branches::branch_merge,
        branches::branch_base_status,
        branches::branch_update_from,
        branches::branch_cleanup_candidates,
        branches::branch_delete_many,
        branches::branch_restore,
        stashes::stash_list,
        stashes::stash_push,
        stashes::stash_apply,
        stashes::stash_drop,
        stashes::stash_restore,
        stashes::stash_branch,
        stashes::stash_files,
        stashes::stash_file_diff,
        stashes::stash_images,
        stashes::stash_find_auto,
        conflicts::conflict_state,
        conflicts::conflict_resolve,
        conflicts::conflict_mark_resolved,
        conflicts::conflict_continue,
        conflicts::conflict_skip,
        conflicts::conflict_abort,
        history::history_list,
        history::history_prepare,
        history::history_prepare_paths,
        history::history_markers,
        history::commit_detail,
        history::commit_file_diff,
        history::commit_images,
        history::commit_signature,
        history::commit_patch,
        history::commit_patch_save,
        history::commit_revert,
        history::commit_cherry_pick,
        history::commit_squash,
        history::commit_reorder,
        history::commit_cherry_pick_onto,
        history::commit_reset,
        history::commit_undo,
        history::commit_checkout,
        history::tag_create,
        history::tag_list,
        history::tag_delete,
        history::compare_get,
        history::compare_file_diff,
        history::compare_images,
        history::lost_commits,
        remote::remote_info,
        remote::remote_fetch,
        remote::remote_pull,
        remote::remote_push,
        remote::remote_publish,
        remote::remote_tag_delete,
        remote::remote_tag_states,
        remote::remote_tag_push,
        remote::logins_list,
        remote::login_forget,
        remote::credential_respond,
        github::github_accounts,
        github::github_sign_in,
        github::github_sign_out,
        pull_requests::pull_request_context,
        pull_requests::pull_request_list,
        pull_requests::pull_request_template,
        pull_requests::pull_request_create,
        settings::settings_get,
        settings::settings_set,
        settings::settings_launch_language,
        settings::system_accent_color,
        settings::git_global_get,
        settings::git_global_set,
        settings::app_restart,
        update::update_status,
        update::update_check,
        update::update_dismiss,
        update::update_install,
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            let data_dir = app.path().app_data_dir()?;
            let repositories = Arc::new(RepositoryStore::load(data_dir.join("repositories.json")));
            app.manage(Arc::clone(&repositories));
            app.manage(Arc::new(accounts::AccountStore::load(
                data_dir.join("accounts.json"),
                Box::new(accounts::Keychain(accounts::KEYCHAIN_SERVICE)),
            )));
            app.manage(Arc::new(settings::SettingsStore::load(
                data_dir.join("settings.json"),
            )));
            app.manage(Arc::new(Operations::default()));
            let logins = Arc::new(logins::LoginStore::load(
                data_dir.join("logins.json"),
                Box::new(accounts::Keychain(logins::KEYCHAIN_SERVICE)),
            ));
            app.manage(Arc::clone(&logins));
            app.manage(Arc::new(askpass::Askpass::start(logins)));
            app.manage(watcher::RepoWatcher::default());
            let (windows, layout) = windows::RepoWindows::load(data_dir.join("windows.json"));
            let windows = Arc::new(windows);
            app.manage(Arc::clone(&windows));
            commands::window::restore_layout(app.handle(), &windows, &repositories, layout);
            app.manage(Arc::new(updater::Updates::default()));
            updater::start_background_checks(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            let windows = app.state::<Arc<windows::RepoWindows>>();
            let label = window.label();
            match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    commands::window::record_placement(&windows, window);
                }
                WindowEvent::Focused(true) => windows.focus(label),
                // Only a window the user closes; quitting destroys them all.
                WindowEvent::CloseRequested { .. } => windows.close(label),
                WindowEvent::Destroyed => {
                    windows.remove(label);
                    let _ = app.state::<watcher::RepoWatcher>().watch(app, label, None);
                }
                _ => {}
            }
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Arc<windows::RepoWindows>>().flush();
            }
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn export_bindings() {
        super::export_bindings(&super::specta_builder());
    }
}
