//! Which repository each window shows. Every window has its own; one
//! repository is open in at most one window, so opening it again brings
//! that window forward.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

/// Prefix of windows opened later; `capabilities/default.json` matches it.
const REPO_WINDOW_PREFIX: &str = "repo-";

#[derive(Default)]
pub struct RepoWindows {
    open: Mutex<HashMap<String, String>>,
    next: AtomicU32,
}

impl RepoWindows {
    /// The repository shown in window `label`, if it has chosen one.
    pub fn get(&self, label: &str) -> Option<String> {
        self.lock().get(label).cloned()
    }

    pub fn set(&self, label: &str, repo: String) {
        self.lock().insert(label.to_owned(), repo);
    }

    /// Forgets a closed window.
    pub fn remove(&self, label: &str) {
        self.lock().remove(label);
    }

    /// The window other than `except` that shows `repo`.
    pub fn find(&self, repo: &str, except: Option<&str>) -> Option<String> {
        self.lock()
            .iter()
            .find(|(label, path)| path.as_str() == repo && Some(label.as_str()) != except)
            .map(|(label, _)| label.clone())
    }

    /// A label no window has used yet.
    pub fn next_label(&self) -> String {
        let n = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        format!("{REPO_WINDOW_PREFIX}{n}")
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.open.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_the_repository_of_each_window() {
        let windows = RepoWindows::default();
        windows.set("main", "/a".into());
        let other = windows.next_label();
        assert_ne!(other, windows.next_label(), "labels are never reused");
        windows.set(&other, "/b".into());

        assert_eq!(windows.get("main").as_deref(), Some("/a"));
        assert_eq!(windows.find("/b", None), Some(other.clone()));
        assert_eq!(windows.find("/b", Some(&other)), None);
        assert_eq!(windows.find("/c", None), None);

        windows.remove(&other);
        assert_eq!(windows.find("/b", None), None);
    }
}
