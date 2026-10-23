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
    macos_apps: &'static [&'static str],
    /// Executable paths relative to well-known Windows base directories.
    windows_exe: &'static [(&'static str, &'static str)],
    /// Command names searched on PATH (Linux).
    linux_bins: &'static [&'static str],
    /// What the editor opens when given a repository folder.
    project: Project,
}

/// IDEs that want a project file rather than any folder.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Project {
    Folder,
    /// An `.xcworkspace`, `.xcodeproj` or Swift package.
    Xcode,
    /// A Gradle build (`settings.gradle`, `build.gradle`).
    Gradle,
}

const EDITORS: &[EditorDef] = &[
    EditorDef {
        id: "vscode",
        name: "Visual Studio Code",
        macos_apps: &["Visual Studio Code.app"],
        windows_exe: &[
            ("LOCALAPPDATA", r"Programs\Microsoft VS Code\Code.exe"),
            ("ProgramFiles", r"Microsoft VS Code\Code.exe"),
        ],
        linux_bins: &["code"],
        project: Project::Folder,
    },
    EditorDef {
        id: "cursor",
        name: "Cursor",
        macos_apps: &["Cursor.app"],
        windows_exe: &[("LOCALAPPDATA", r"Programs\cursor\Cursor.exe")],
        linux_bins: &["cursor"],
        project: Project::Folder,
    },
    EditorDef {
        id: "zed",
        name: "Zed",
        macos_apps: &["Zed.app"],
        windows_exe: &[("LOCALAPPDATA", r"Programs\Zed\Zed.exe")],
        linux_bins: &["zed", "zeditor"],
        project: Project::Folder,
    },
    EditorDef {
        id: "sublime",
        name: "Sublime Text",
        macos_apps: &["Sublime Text.app"],
        windows_exe: &[("ProgramFiles", r"Sublime Text\sublime_text.exe")],
        linux_bins: &["subl"],
        project: Project::Folder,
    },
    EditorDef {
        id: "xcode",
        name: "Xcode",
        macos_apps: &["Xcode.app"],
        windows_exe: &[],
        linux_bins: &[],
        project: Project::Xcode,
    },
    EditorDef {
        id: "android_studio",
        name: "Android Studio",
        macos_apps: &["Android Studio.app"],
        windows_exe: &[("ProgramFiles", r"Android\Android Studio\bin\studio64.exe")],
        linux_bins: &["android-studio", "studio"],
        project: Project::Gradle,
    },
    EditorDef {
        id: "intellij",
        name: "IntelliJ IDEA",
        macos_apps: &[
            "IntelliJ IDEA.app",
            "IntelliJ IDEA Ultimate.app",
            "IntelliJ IDEA CE.app",
        ],
        windows_exe: &[],
        linux_bins: &["idea", "intellij-idea-ultimate", "intellij-idea-community"],
        project: Project::Folder,
    },
    EditorDef {
        id: "webstorm",
        name: "WebStorm",
        macos_apps: &["WebStorm.app"],
        windows_exe: &[],
        linux_bins: &["webstorm"],
        project: Project::Folder,
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

/// Ids of the editors whose kind of project `dir` holds (an Xcode project,
/// a Gradle build), installed or not. Plain folders suggest nothing.
pub fn suggested_editors(dir: &Path) -> Vec<String> {
    EDITORS
        .iter()
        .filter(|def| def.project != Project::Folder && find_project(def.project, dir).is_some())
        .map(|def| def.id.into())
        .collect()
}

/// Opens `path` in the editor. A folder given to an IDE that wants a
/// project file opens the project inside it, if there is one.
pub fn open_in_editor(editor_id: &str, path: &Path) -> AppResult<()> {
    let def = EDITORS
        .iter()
        .find(|d| d.id == editor_id)
        .ok_or_else(|| not_found(editor_id))?;
    let location = locate_editor(def).ok_or_else(|| not_found(def.name))?;
    let target = if path.is_dir() {
        find_project(def.project, path).unwrap_or_else(|| path.to_owned())
    } else {
        path.to_owned()
    };
    let mut command = if cfg!(target_os = "macos") {
        let mut c = Command::new("open");
        c.arg("-a").arg(location);
        c
    } else {
        Command::new(location)
    };
    command.arg(target);
    spawn_detached(command)
}

/// Folders where mobile apps keep their native projects, next to a
/// cross-platform one (React Native, Flutter, Capacitor).
const NATIVE_SUBDIRS: &[&str] = &["ios", "macos", "android"];

/// The project an IDE should open for the repository at `dir`: one at the
/// top, or in a native subfolder.
fn find_project(project: Project, dir: &Path) -> Option<PathBuf> {
    if project == Project::Folder {
        return None;
    }
    std::iter::once(dir.to_owned())
        .chain(NATIVE_SUBDIRS.iter().map(|sub| dir.join(sub)))
        .find_map(|d| project_in(project, &d))
}

fn project_in(project: Project, dir: &Path) -> Option<PathBuf> {
    match project {
        Project::Folder => None,
        Project::Xcode => {
            // CocoaPods projects have both; the workspace includes the pods.
            first_with_extension(dir, "xcworkspace")
                .or_else(|| first_with_extension(dir, "xcodeproj"))
                .or_else(|| dir.join("Package.swift").is_file().then(|| dir.to_owned()))
        }
        Project::Gradle => [
            "settings.gradle",
            "settings.gradle.kts",
            "build.gradle",
            "build.gradle.kts",
        ]
        .iter()
        .any(|f| dir.join(f).is_file())
        .then(|| dir.to_owned()),
    }
}

/// The alphabetically first entry in `dir` ending in `.extension`.
fn first_with_extension(dir: &Path, extension: &str) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == extension))
        .collect();
    found.sort();
    found.into_iter().next()
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
            .flat_map(|dir| def.macos_apps.iter().map(move |app| dir.join(app)))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "").unwrap();
    }

    #[test]
    fn plain_folders_suggest_no_ide() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("package.json"));
        assert!(suggested_editors(dir.path()).is_empty());
        assert_eq!(find_project(Project::Xcode, dir.path()), None);
    }

    #[test]
    fn xcode_prefers_the_workspace_then_the_project_then_a_package() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir(root.join("App.xcodeproj")).unwrap();
        assert_eq!(
            find_project(Project::Xcode, root),
            Some(root.join("App.xcodeproj"))
        );

        fs::create_dir(root.join("App.xcworkspace")).unwrap();
        assert_eq!(
            find_project(Project::Xcode, root),
            Some(root.join("App.xcworkspace"))
        );

        let package = tempfile::tempdir().unwrap();
        touch(&package.path().join("Package.swift"));
        assert_eq!(
            find_project(Project::Xcode, package.path()),
            Some(package.path().to_owned())
        );
    }

    #[test]
    fn cross_platform_apps_open_their_native_subfolders() {
        // A React Native layout: JavaScript at the top, native apps below.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        touch(&root.join("package.json"));
        fs::create_dir_all(root.join("ios/App.xcworkspace")).unwrap();
        touch(&root.join("android/settings.gradle"));

        assert_eq!(
            find_project(Project::Xcode, root),
            Some(root.join("ios/App.xcworkspace"))
        );
        assert_eq!(
            find_project(Project::Gradle, root),
            Some(root.join("android"))
        );
        assert_eq!(suggested_editors(root), ["xcode", "android_studio"]);
    }

    #[test]
    fn gradle_builds_open_at_the_top() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("settings.gradle.kts"));
        touch(&dir.path().join("android/settings.gradle"));
        assert_eq!(
            find_project(Project::Gradle, dir.path()),
            Some(dir.path().to_owned())
        );
    }
}
