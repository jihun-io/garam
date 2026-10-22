//! Reading the operating system's accent color, for the "system" accent.
//!
//! Each platform keeps it somewhere different; `None` means it couldn't be
//! read here and the app falls back to its own color.

use std::process::{Command, Stdio};

/// The accent color as `#rrggbb`, if the platform exposes one.
pub fn accent_color() -> Option<String> {
    if cfg!(target_os = "macos") {
        macos_accent()
    } else if cfg!(windows) {
        windows_accent()
    } else {
        linux_accent()
    }
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// macOS stores the choice as an index in `AppleAccentColor`; no value
/// means the default (multicolor, shown as blue).
fn macos_accent() -> Option<String> {
    let index = run("defaults", &["read", "-g", "AppleAccentColor"]);
    Some(macos_color(index.as_deref()).to_owned())
}

fn macos_color(index: Option<&str>) -> &'static str {
    match index.map(str::trim) {
        Some("-1") => "#8c8c8c", // graphite
        Some("0") => "#e0383e",  // red
        Some("1") => "#f7821b",  // orange
        Some("2") => "#ffc600",  // yellow
        Some("3") => "#62ba46",  // green
        Some("5") => "#953d96",  // purple
        Some("6") => "#f74f9e",  // pink
        _ => "#007aff",          // blue, and multicolor
    }
}

/// `AccentColor` in the DWM registry key, a DWORD in 0xAABBGGRR order.
fn windows_accent() -> Option<String> {
    let out = run(
        "reg",
        &[
            "query",
            r"HKCU\Software\Microsoft\Windows\DWM",
            "/v",
            "AccentColor",
        ],
    )?;
    parse_windows_dword(&out)
}

fn parse_windows_dword(reg_output: &str) -> Option<String> {
    let hex = reg_output
        .split_whitespace()
        .find_map(|word| word.strip_prefix("0x"))?;
    let value = u32::from_str_radix(hex, 16).ok()?;
    let [r, g, b] = [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
    Some(format!("#{r:02x}{g:02x}{b:02x}"))
}

/// GNOME 47+ names the accent; KDE stores it as `r,g,b` in kdeglobals.
fn linux_accent() -> Option<String> {
    if let Some(name) = run(
        "gsettings",
        &["get", "org.gnome.desktop.interface", "accent-color"],
    ) && let Some(color) = gnome_color(&name)
    {
        return Some(color.to_owned());
    }
    let home = std::env::var_os("HOME")?;
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(home).join(".config"));
    let kdeglobals = std::fs::read_to_string(config.join("kdeglobals")).ok()?;
    parse_kde_accent(&kdeglobals)
}

fn gnome_color(name: &str) -> Option<&'static str> {
    Some(match name.trim().trim_matches('\'') {
        "blue" => "#3584e4",
        "teal" => "#2190a4",
        "green" => "#3a944a",
        "yellow" => "#c88800",
        "orange" => "#ed5b00",
        "red" => "#e62d42",
        "pink" => "#d56199",
        "purple" => "#9141ac",
        "slate" => "#6f8396",
        _ => return None,
    })
}

fn parse_kde_accent(kdeglobals: &str) -> Option<String> {
    let mut in_general = false;
    for line in kdeglobals.lines().map(str::trim) {
        if line.starts_with('[') {
            in_general = line == "[General]";
        } else if in_general && let Some(value) = line.strip_prefix("AccentColor=") {
            let parts: Vec<u8> = value
                .split(',')
                .filter_map(|p| p.trim().parse().ok())
                .collect();
            if let [r, g, b, ..] = parts[..] {
                return Some(format!("#{r:02x}{g:02x}{b:02x}"));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_macos_accent_indexes() {
        assert_eq!(macos_color(None), "#007aff");
        assert_eq!(macos_color(Some("5\n")), "#953d96");
        assert_eq!(macos_color(Some("-1")), "#8c8c8c");
    }

    #[test]
    fn parses_windows_registry_output() {
        let out = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\DWM\r\n    AccentColor    REG_DWORD    0xffd77800\r\n";
        assert_eq!(parse_windows_dword(out).as_deref(), Some("#0078d7"));
        assert_eq!(parse_windows_dword("nothing"), None);
    }

    #[test]
    fn reads_linux_desktop_settings() {
        assert_eq!(gnome_color("'teal'"), Some("#2190a4"));
        assert_eq!(gnome_color("'unknown'"), None);
        let kde = "[Colors:View]\nAccentColor=1,2,3\n[General]\nAccentColor=61,174,233\n";
        assert_eq!(parse_kde_accent(kde).as_deref(), Some("#3daee9"));
        assert_eq!(parse_kde_accent("[General]\nName=x\n"), None);
    }
}
