//! Opening a repository in other apps: file manager, terminal, editors.
//!
//! These spawn non-git programs, so they don't go through `GitCommand`.

use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

use crate::error::{AppError, AppErrorKind, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ExternalEditor {
    pub id: String,
    pub name: String,
}

struct EditorDef {
    id: &'static str,
    name: &'static str,
    /// App bundle names searched in /Applications and ~/Applications.
    macos_app: &'static str,
    /// Executable paths relative to well-known Windows base directories.
    windows_exe: &'static [(&'static str, &'static str)],
    /// Command names searched on PATH (Linux).
    linux_bins: &'static [&'static str],
}

const EDITORS: &[EditorDef] = &[
    EditorDef {
        id: "vscode",
        name: "Visual Studio Code",
        macos_app: "Visual Studio Code.app",
        windows_exe: &[
            ("LOCALAPPDATA", r"Programs\Microsoft VS Code\Code.exe"),
            ("ProgramFiles", r"Microsoft VS Code\Code.exe"),
        ],
        linux_bins: &["code"],
    },
    EditorDef {
        id: "cursor",
        name: "Cursor",
        macos_app: "Cursor.app",
        windows_exe: &[("LOCALAPPDATA", r"Programs\cursor\Cursor.exe")],
        linux_bins: &["cursor"],
    },
    EditorDef {
        id: "zed",
        name: "Zed",
        macos_app: "Zed.app",
        windows_exe: &[("LOCALAPPDATA", r"Programs\Zed\Zed.exe")],
        linux_bins: &["zed", "zeditor"],
    },
    EditorDef {
        id: "sublime",
        name: "Sublime Text",
        macos_app: "Sublime Text.app",
        windows_exe: &[("ProgramFiles", r"Sublime Text\sublime_text.exe")],
        linux_bins: &["subl"],
    },
];

/// Editors installed on this machine, in a fixed order.
pub fn detect_editors() -> Vec<ExternalEditor> {
    EDITORS
        .iter()
        .filter(|def| locate_editor(def).is_some())
        .map(|def| ExternalEditor {
            id: def.id.into(),
            name: def.name.into(),
        })
        .collect()
}

pub fn open_in_editor(editor_id: &str, dir: &Path) -> AppResult<()> {
    let def = EDITORS
        .iter()
        .find(|d| d.id == editor_id)
        .ok_or_else(|| not_found(editor_id))?;
    let location = locate_editor(def).ok_or_else(|| not_found(def.name))?;
    let mut command = if cfg!(target_os = "macos") {
        let mut c = Command::new("open");
        c.arg("-a").arg(location);
        c
    } else {
        Command::new(location)
    };
    command.arg(dir);
    spawn_detached(command)
}

pub fn open_in_terminal(dir: &Path) -> AppResult<()> {
    let mut command = if cfg!(target_os = "macos") {
        let mut c = Command::new("open");
        c.args(["-a", "Terminal"]).arg(dir);
        c
    } else if cfg!(windows) {
        if let Some(wt) = find_on_path("wt") {
            let mut c = Command::new(wt);
            c.arg("-d").arg(dir);
            c
        } else {
            // `start` opens a new console window running cmd in `dir`.
            let mut c = Command::new("cmd.exe");
            c.args(["/C", "start", "cmd.exe"]).current_dir(dir);
            c
        }
    } else {
        const TERMINALS: &[&str] = &[
            "x-terminal-emulator",
            "gnome-terminal",
            "konsole",
            "xfce4-terminal",
            "kitty",
            "alacritty",
            "xterm",
        ];
        let bin = TERMINALS
            .iter()
            .find_map(|t| find_on_path(t))
            .ok_or_else(|| not_found("terminal"))?;
        let mut c = Command::new(bin);
        c.current_dir(dir);
        c
    };
    command.current_dir(dir);
    spawn_detached(command)
}

pub fn reveal_in_file_manager(dir: &Path) -> AppResult<()> {
    tauri_plugin_opener::reveal_item_in_dir(dir)
        .map_err(|e| AppError::app(AppErrorKind::ExternalAppFailed, Some(e.to_string())))
}

fn locate_editor(def: &EditorDef) -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        let home_apps = env::var_os("HOME").map(|h| PathBuf::from(h).join("Applications"));
        [Some(PathBuf::from("/Applications")), home_apps]
            .into_iter()
            .flatten()
            .map(|dir| dir.join(def.macos_app))
            .find(|p| p.exists())
    } else if cfg!(windows) {
        def.windows_exe
            .iter()
            .filter_map(|(base, rel)| env::var_os(base).map(|b| PathBuf::from(b).join(rel)))
            .find(|p| p.is_file())
    } else {
        def.linux_bins.iter().find_map(|b| find_on_path(b))
    }
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    };
    env::split_paths(&env::var_os("PATH")?)
        .map(|dir| dir.join(&file))
        .find(|p| p.is_file())
}

/// Starts the program without waiting for it, and reaps it in the
/// background so it doesn't linger as a zombie process.
fn spawn_detached(mut command: Command) -> AppResult<()> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::app(AppErrorKind::ExternalAppFailed, Some(e.to_string())))?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

fn not_found(what: &str) -> AppError {
    AppError::app(AppErrorKind::ExternalAppNotFound, Some(what.to_owned()))
}
