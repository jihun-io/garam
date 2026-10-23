//! Restarting the app, after an update or a language change.
//!
//! On macOS, Tauri's `restart` relaunches with `open -n` while this process
//! is still running. `-n` starts a second instance, and the Dock gives a
//! second instance its own tile, so the restarted app shows up beside the
//! icon kept in the Dock instead of in it. Here a detached shell waits for
//! this process to end and only then opens the bundle, as a normal launch.

use tauri::AppHandle;

/// Restarts the app. Doesn't return.
pub fn restart(app: &AppHandle) -> ! {
    // If the shell can't start, Tauri's way still restarts, just with the
    // second Dock icon.
    #[cfg(target_os = "macos")]
    if let Some(bundle) = bundle_path()
        && open_after_exit(&bundle).is_ok()
    {
        std::process::exit(0);
    }
    app.restart()
}

/// The `.app` bundle this process runs from, if it runs from one (not
/// `tauri dev`).
#[cfg(target_os = "macos")]
fn bundle_path() -> Option<std::path::PathBuf> {
    let exe = tauri::utils::platform::current_exe().ok()?;
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    (macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app")
        .then(|| bundle.to_path_buf())
}

/// Starts a shell that outlives this process: it waits up to 10 seconds for
/// this process to exit, then opens `bundle` through LaunchServices.
#[cfg(target_os = "macos")]
fn open_after_exit(bundle: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    const SCRIPT: &str = r#"i=0
while kill -0 "$1" 2>/dev/null && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i + 1)); done
exec /usr/bin/open "$2""#;

    Command::new("/bin/sh")
        .arg("-c")
        .arg(SCRIPT)
        .arg("sh")
        .arg(std::process::id().to_string())
        .arg(bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // Its own process group, so nothing aimed at ours reaches it.
        .process_group(0)
        .spawn()
        .map(drop)
}
