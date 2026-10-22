//! Makes macOS's own menu items (Writing Tools, Emoji & Symbols, ...)
//! follow the app's language instead of the system's.
//!
//! AppKit picks the app's localization once, at launch, from the
//! `AppleLanguages` preference. Garam keeps that preference in step with
//! its language setting; a change shows after the next launch. This runs
//! the `defaults` tool rather than calling Foundation directly, because the
//! workspace forbids `unsafe` code.

#[cfg(target_os = "macos")]
use std::path::PathBuf;
use std::process::{Command, Stdio};

const KEY: &str = "AppleLanguages";

/// Sets (or, for `None`, removes) the app's preferred language. Does
/// nothing when it's already right, so most launches only read.
pub fn sync(domain: &str, language: Option<&str>) {
    if !cfg!(target_os = "macos") {
        return;
    }
    if current(domain).as_deref() == language {
        return;
    }
    let mut command = Command::new("defaults");
    match language {
        Some(lang) => command.args(["write", domain, KEY, "-array", lang]),
        None => command.args(["delete", domain, KEY]),
    };
    let _ = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// The first language in the app's `AppleLanguages`, if set.
fn current(domain: &str) -> Option<String> {
    let output = Command::new("defaults")
        .args(["read", domain, KEY])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| first_language(&String::from_utf8_lossy(&output.stdout)))
        .flatten()
}

/// Parses `defaults read` output for an array: `(\n    ko\n)` → `ko`.
fn first_language(output: &str) -> Option<String> {
    output
        .lines()
        .map(|line| line.trim().trim_end_matches(',').trim_matches('"'))
        .find(|line| !line.is_empty() && *line != "(" && *line != ")")
        .map(str::to_owned)
}

/// Where Tauri keeps app data on macOS, for reading settings before the
/// app (and its path resolver) exists.
#[cfg(target_os = "macos")]
pub fn macos_data_dir(identifier: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join("Library/Application Support")
            .join(identifier),
    )
}

#[cfg(test)]
mod tests {
    use super::first_language;

    #[test]
    fn reads_the_first_language_of_an_array() {
        assert_eq!(first_language("(\n    ko\n)\n").as_deref(), Some("ko"));
        assert_eq!(
            first_language("(\n    \"en-US\",\n    ko\n)\n").as_deref(),
            Some("en-US")
        );
        assert_eq!(first_language("(\n)\n"), None);
    }
}
