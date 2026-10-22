//! Watches each window's repository and tells the frontend when it
//! changed, so status and diffs refresh without polling.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_full::notify::{self, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, NoCache, new_debouncer_opt};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const REPO_CHANGED_EVENT: &str = "repo-changed";

#[derive(Clone, Serialize)]
pub struct RepoChanged {
    pub path: String,
}

// No file id cache: it only pairs up rename events, which don't matter
// here, and on macOS and Windows building it walks and stats every file in
// the repository (100k files in a large one) while the lock is held.
type Watcher = Debouncer<RecommendedWatcher, NoCache>;

/// One watcher per window, keyed by window label.
#[derive(Default)]
pub struct RepoWatcher(Mutex<HashMap<String, (String, Watcher)>>);

impl RepoWatcher {
    /// Watches `repo` for window `window` instead of whatever it watched
    /// before; `None` stops.
    pub fn watch(
        &self,
        app: &AppHandle,
        window: &str,
        repo: Option<String>,
    ) -> notify_debouncer_full::notify::Result<()> {
        let mut watchers = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if watchers.get(window).map(|(p, _)| p) == repo.as_ref() {
            return Ok(());
        }
        // Dropping the old debouncer stops it.
        watchers.remove(window);
        let Some(repo) = repo else {
            return Ok(());
        };

        let root = PathBuf::from(&repo);
        let app = app.clone();
        let payload = RepoChanged { path: repo.clone() };
        let event_root = root.clone();
        let mut debouncer = new_debouncer_opt(
            Duration::from_millis(250),
            None,
            move |result: DebounceEventResult| {
                let Ok(events) = result else { return };
                let relevant = events
                    .iter()
                    .flat_map(|e| e.paths.iter())
                    .any(|p| is_relevant(&event_root, p));
                if relevant {
                    let _ = app.emit(REPO_CHANGED_EVENT, payload.clone());
                }
            },
            NoCache,
            notify::Config::default(),
        )?;
        debouncer.watch(&root, RecursiveMode::Recursive)?;
        watchers.insert(window.to_owned(), (repo, debouncer));
        Ok(())
    }
}

/// Working tree files always count. Inside `.git`, only files that change
/// what status shows count; object writes and lock files are noise.
fn is_relevant(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else {
        return true;
    };
    let mut components = rel.components();
    match components.next() {
        Some(Component::Normal(first)) if first == ".git" => {}
        _ => return true,
    }
    let rest: Vec<String> = components
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    let Some(name) = rest.last() else {
        return false;
    };
    if name.ends_with(".lock") {
        return false;
    }
    matches!(
        rest.first().map(String::as_str),
        Some(
            "index"
                | "HEAD"
                | "MERGE_HEAD"
                | "ORIG_HEAD"
                | "REVERT_HEAD"
                | "CHERRY_PICK_HEAD"
                | "rebase-merge"
                | "rebase-apply"
                | "packed-refs"
                | "refs"
        )
    )
}

#[cfg(test)]
mod tests {
    use super::is_relevant;
    use std::path::Path;

    #[test]
    fn filters_git_internals() {
        let root = Path::new("/repo");
        assert!(is_relevant(root, Path::new("/repo/src/main.rs")));
        assert!(is_relevant(root, Path::new("/repo/.gitignore")));
        assert!(is_relevant(root, Path::new("/repo/.git/index")));
        assert!(is_relevant(root, Path::new("/repo/.git/HEAD")));
        assert!(is_relevant(root, Path::new("/repo/.git/refs/heads/main")));
        assert!(is_relevant(root, Path::new("/repo/.git/REVERT_HEAD")));
        assert!(is_relevant(root, Path::new("/repo/.git/rebase-merge/done")));
        assert!(!is_relevant(root, Path::new("/repo/.git/index.lock")));
        assert!(!is_relevant(root, Path::new("/repo/.git/objects/ab/cdef")));
        assert!(!is_relevant(root, Path::new("/repo/.git/logs/HEAD")));
        assert!(!is_relevant(root, Path::new("/repo/.git")));
    }
}
