//! Which repository each window shows, and where the repository windows
//! sit so the next launch opens them again. Every window has its own
//! repository; one repository is open in at most one window, so opening it
//! again brings that window forward.
//!
//! The layout is saved to `windows.json` as windows open, close, take
//! focus or change repository, and once more when the app exits. Quitting
//! destroys windows without asking them to close, so only a window the
//! user closes leaves the layout, and the last one stays to come back.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use serde::{Deserialize, Serialize};

use crate::storage;

/// Label of the window `tauri.conf.json` creates at launch.
pub const MAIN_WINDOW: &str = "main";

/// Prefix of windows opened later; `capabilities/default.json` matches it.
const REPO_WINDOW_PREFIX: &str = "repo-";

/// Where a window sits on the desktop, in physical pixels. The position is
/// the outer frame's; the size is the content's, as `set_size` takes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Placement {
    pub repo: Option<String>,
    /// Kept from before the window was maximized or made full screen, so
    /// leaving that state goes back to it.
    pub bounds: Option<Bounds>,
    pub maximized: bool,
    pub fullscreen: bool,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct SavedLayout {
    /// Least recently focused first.
    windows: Vec<Placement>,
}

#[derive(Default)]
struct State {
    /// The repository each window shows; a destroyed window leaves it.
    repos: HashMap<String, String>,
    /// Repository windows to restore, least recently focused first.
    layout: Vec<(String, Placement)>,
    /// The last window, kept in the layout after the user closed it. A
    /// window opened later replaces it.
    closed_last: Option<String>,
}

#[derive(Default)]
pub struct RepoWindows {
    state: Mutex<State>,
    next: AtomicU32,
    /// Where the layout is saved; none in tests.
    file: Option<PathBuf>,
}

impl RepoWindows {
    /// Starts with no windows, and returns the layout saved last time.
    pub fn load(file: PathBuf) -> (Self, Vec<Placement>) {
        let saved: SavedLayout = storage::load(&file);
        let windows = Self {
            file: Some(file),
            ..Self::default()
        };
        (windows, saved.windows)
    }

    /// The repository shown in window `label`, if it has chosen one.
    pub fn get(&self, label: &str) -> Option<String> {
        self.lock().repos.get(label).cloned()
    }

    pub fn set(&self, label: &str, repo: String) {
        let mut state = self.lock();
        state.repos.insert(label.to_owned(), repo.clone());
        if is_repo_window(label) {
            state.placement(label).repo = Some(repo);
            self.save(&state);
        }
    }

    /// Records where window `label` sits now. Kept in memory until the
    /// next save, since this follows every step of a drag.
    pub fn place(&self, label: &str, bounds: Option<Bounds>, maximized: bool, fullscreen: bool) {
        if !is_repo_window(label) {
            return;
        }
        let mut state = self.lock();
        let placement = state.placement(label);
        if bounds.is_some() {
            placement.bounds = bounds;
        }
        placement.maximized = maximized;
        placement.fullscreen = fullscreen;
    }

    /// Window `label` came to the front; it opens on top next time.
    pub fn focus(&self, label: &str) {
        if !is_repo_window(label) {
            return;
        }
        let mut state = self.lock();
        state.placement(label);
        if let Some(placement) = state.take(label) {
            state.layout.push((label.to_owned(), placement));
        }
        self.save(&state);
    }

    /// The user closed window `label`; it won't come back, unless it is
    /// the last repository window.
    pub fn close(&self, label: &str) {
        if !is_repo_window(label) {
            return;
        }
        let mut state = self.lock();
        if state.layout.iter().any(|(other, _)| other != label) {
            state.take(label);
            self.save(&state);
        } else {
            state.closed_last = Some(label.to_owned());
        }
    }

    /// Forgets a destroyed window's repository. Its place in the layout
    /// stays: when the app quits, every window is destroyed.
    pub fn remove(&self, label: &str) {
        self.lock().repos.remove(label);
    }

    /// Saves the layout as it is now.
    pub fn flush(&self) {
        self.save(&self.lock());
    }

    /// The window other than `except` that shows `repo`.
    pub fn find(&self, repo: &str, except: Option<&str>) -> Option<String> {
        self.lock()
            .repos
            .iter()
            .find(|(label, path)| path.as_str() == repo && Some(label.as_str()) != except)
            .map(|(label, _)| label.clone())
    }

    /// A label no window has used yet.
    pub fn next_label(&self) -> String {
        let n = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        format!("{REPO_WINDOW_PREFIX}{n}")
    }

    fn save(&self, state: &State) {
        let Some(file) = &self.file else {
            return;
        };
        let layout = SavedLayout {
            windows: state.layout.iter().map(|(_, p)| p.clone()).collect(),
        };
        if let Err(err) = storage::save(file, &layout) {
            eprintln!("couldn't save the window layout: {err:?}");
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl State {
    /// The layout entry of `label`, added if it is new.
    fn placement(&mut self, label: &str) -> &mut Placement {
        let index = match self.layout.iter().position(|(l, _)| l == label) {
            Some(index) => index,
            None => {
                if let Some(closed) = self.closed_last.take() {
                    self.take(&closed);
                }
                self.layout.push((label.to_owned(), Placement::default()));
                self.layout.len() - 1
            }
        };
        &mut self.layout[index].1
    }

    fn take(&mut self, label: &str) -> Option<Placement> {
        let index = self.layout.iter().position(|(l, _)| l == label)?;
        Some(self.layout.remove(index).1)
    }
}

/// Repository windows, as opposed to the settings and About windows.
fn is_repo_window(label: &str) -> bool {
    label == MAIN_WINDOW || label.starts_with(REPO_WINDOW_PREFIX)
}

/// Whether enough of a window's title bar would be on one of `monitors`
/// (`(x, y, width, height)`) to grab it. A monitor that was unplugged
/// since leaves it nowhere.
pub fn reachable(bounds: &Bounds, monitors: &[Bounds]) -> bool {
    const TITLE_BAR: i64 = 40;
    const MIN_VISIBLE: i64 = 80;
    let (left, top) = (i64::from(bounds.x), i64::from(bounds.y));
    let right = left + i64::from(bounds.width);
    monitors.iter().any(|m| {
        let (m_left, m_top) = (i64::from(m.x), i64::from(m.y));
        let (m_right, m_bottom) = (m_left + i64::from(m.width), m_top + i64::from(m.height));
        let width = right.min(m_right) - left.max(m_left);
        let height = (top + TITLE_BAR).min(m_bottom) - top.max(m_top);
        width >= MIN_VISIBLE && height > 0
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(x: i32, y: i32, width: u32, height: u32) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

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

    fn saved(windows: &RepoWindows) -> Vec<Option<String>> {
        let state = windows.lock();
        state.layout.iter().map(|(_, p)| p.repo.clone()).collect()
    }

    #[test]
    fn keeps_windows_destroyed_by_quitting() {
        let windows = RepoWindows::default();
        windows.set("main", "/a".into());
        windows.set("repo-1", "/b".into());
        windows.remove("main");
        windows.remove("repo-1");
        assert_eq!(saved(&windows), [Some("/a".into()), Some("/b".into())]);
    }

    #[test]
    fn drops_a_window_the_user_closed_unless_it_is_the_last() {
        let windows = RepoWindows::default();
        windows.set("main", "/a".into());
        windows.set("repo-1", "/b".into());
        windows.close("main");
        assert_eq!(saved(&windows), [Some("/b".into())]);

        windows.close("repo-1");
        assert_eq!(saved(&windows), [Some("/b".into())], "comes back next time");
        windows.set("repo-2", "/c".into());
        assert_eq!(
            saved(&windows),
            [Some("/c".into())],
            "replaced by a new one"
        );
    }

    #[test]
    fn opens_the_last_focused_window_on_top() {
        let windows = RepoWindows::default();
        windows.set("main", "/a".into());
        windows.set("repo-1", "/b".into());
        windows.focus("main");
        assert_eq!(saved(&windows), [Some("/b".into()), Some("/a".into())]);
    }

    #[test]
    fn leaves_out_settings_and_about() {
        let windows = RepoWindows::default();
        windows.set("settings", "/a".into());
        windows.focus("about");
        windows.place("settings", Some(bounds(0, 0, 10, 10)), false, false);
        assert!(saved(&windows).is_empty());
        assert_eq!(windows.get("settings").as_deref(), Some("/a"));
    }

    #[test]
    fn keeps_the_bounds_from_before_maximizing() {
        let windows = RepoWindows::default();
        windows.place("main", Some(bounds(10, 20, 800, 600)), false, false);
        windows.place("main", None, true, false);
        let state = windows.lock();
        let placement = &state.layout[0].1;
        assert_eq!(placement.bounds, Some(bounds(10, 20, 800, 600)));
        assert!(placement.maximized);
    }

    #[test]
    fn restores_only_windows_that_can_be_reached() {
        let screens = [bounds(0, 0, 1920, 1080), bounds(1920, 0, 1280, 800)];
        assert!(reachable(&bounds(100, 100, 800, 600), &screens));
        assert!(
            reachable(&bounds(2000, 50, 800, 600), &screens),
            "second screen"
        );
        assert!(
            reachable(&bounds(-700, 100, 800, 600), &screens),
            "mostly off the left"
        );
        assert!(
            !reachable(&bounds(-780, 100, 800, 600), &screens),
            "too little left"
        );
        assert!(
            !reachable(&bounds(100, -40, 800, 600), &screens),
            "title bar above"
        );
        assert!(
            !reachable(&bounds(4000, 100, 800, 600), &screens),
            "unplugged screen"
        );
    }
}
