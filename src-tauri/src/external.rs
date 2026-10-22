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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ExternalTerminal {
    pub id: String,
    pub name: String,
}

type Launch = Box<dyn Fn(&Path) -> Command>;

/// Terminals installed on this machine, in a fixed order, each with how to
/// open it in a folder.
fn available_terminals() -> Vec<(ExternalTerminal, Launch)> {
    let terminal = |id: &str, name: &str| ExternalTerminal {
        id: id.into(),
        name: name.into(),
    };
    let mut found: Vec<(ExternalTerminal, Launch)> = Vec::new();
    if cfg!(target_os = "macos") {
        const APPS: &[(&str, &str, &str)] = &[
            ("terminal", "Terminal", "Terminal.app"),
            ("iterm", "iTerm", "iTerm.app"),
            ("ghostty", "Ghostty", "Ghostty.app"),
            ("warp", "Warp", "Warp.app"),
            ("wezterm", "WezTerm", "WezTerm.app"),
            ("kitty", "kitty", "kitty.app"),
            ("alacritty", "Alacritty", "Alacritty.app"),
        ];
        let home_apps = env::var_os("HOME").map(|h| PathBuf::from(h).join("Applications"));
        let dirs: Vec<PathBuf> = [
            Some(PathBuf::from("/Applications")),
            Some(PathBuf::from("/Applications/Utilities")),
            Some(PathBuf::from("/System/Applications/Utilities")),
            home_apps,
        ]
        .into_iter()
        .flatten()
        .collect();
        for (id, name, app) in APPS {
            if let Some(path) = dirs.iter().map(|d| d.join(app)).find(|p| p.exists()) {
                let launch: Launch = Box::new(move |dir| {
                    let mut c = Command::new("open");
                    c.arg("-a").arg(&path).arg(dir);
                    c
                });
                found.push((terminal(id, name), launch));
            }
        }
    } else if cfg!(windows) {
        if let Some(wt) = find_on_path("wt") {
            let launch: Launch = Box::new(move |dir| {
                let mut c = Command::new(&wt);
                c.arg("-d").arg(dir);
                c
            });
            found.push((terminal("windows_terminal", "Windows Terminal"), launch));
        }
        if let Some(shell) = find_on_path("pwsh").or_else(|| find_on_path("powershell")) {
            let launch: Launch = Box::new(move |dir| {
                // `start` opens a new console window running the shell.
                let mut c = Command::new("cmd.exe");
                c.args(["/C", "start", ""]).arg(&shell).arg("-NoExit");
                c.current_dir(dir);
                c
            });
            found.push((terminal("powershell", "PowerShell"), launch));
        }
        let launch: Launch = Box::new(|dir| {
            let mut c = Command::new("cmd.exe");
            c.args(["/C", "start", "cmd.exe"]).current_dir(dir);
            c
        });
        found.push((terminal("cmd", "Command Prompt"), launch));
    } else {
        const BINS: &[(&str, &str)] = &[
            ("x-terminal-emulator", "System default"),
            ("gnome-terminal", "GNOME Terminal"),
            ("ptyxis", "Ptyxis"),
            ("konsole", "Konsole"),
            ("xfce4-terminal", "Xfce Terminal"),
            ("ghostty", "Ghostty"),
            ("wezterm", "WezTerm"),
            ("kitty", "kitty"),
            ("alacritty", "Alacritty"),
            ("xterm", "XTerm"),
        ];
        for (bin, name) in BINS {
            if let Some(path) = find_on_path(bin) {
                let launch: Launch = Box::new(move |dir| {
                    let mut c = Command::new(&path);
                    c.current_dir(dir);
                    c
                });
                found.push((terminal(bin, name), launch));
            }
        }
    }
    found
}

pub fn detect_terminals() -> Vec<ExternalTerminal> {
    available_terminals().into_iter().map(|(t, _)| t).collect()
}

/// Opens `dir` in the terminal `terminal_id`, or the first one found if
/// that one isn't installed (or none was chosen).
pub fn open_in_terminal(dir: &Path, terminal_id: Option<&str>) -> AppResult<()> {
    let mut terminals = available_terminals();
    let index = terminal_id
        .and_then(|id| terminals.iter().position(|(t, _)| t.id == id))
        .unwrap_or(0);
    if terminals.is_empty() {
        return Err(not_found("terminal"));
    }
    let (_, launch) = terminals.swap_remove(index);
    spawn_detached(launch(dir))
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
