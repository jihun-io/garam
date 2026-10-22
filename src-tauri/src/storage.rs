//! JSON files in the app data folder, written atomically.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::{AppError, AppResult};

/// Reads `file`. A missing file gives the default. A file that can't be
/// read is moved aside (never silently overwritten) and the default used.
pub fn load<T: DeserializeOwned + Default>(file: &Path) -> T {
    match fs::read(file) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|err| {
            let backup = file.with_extension(format!("corrupt-{}.json", now_ms() as u64));
            eprintln!(
                "{} is unreadable ({err}); moved to {}",
                file.display(),
                backup.display()
            );
            let _ = fs::rename(file, &backup);
            T::default()
        }),
        Err(_) => T::default(),
    }
}

/// Writes to a temp file next to `file`, then renames it into place.
pub fn save<T: Serialize>(file: &Path, value: &T) -> AppResult<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(AppError::storage)?;
    }
    let json = serde_json::to_vec_pretty(value).map_err(AppError::storage)?;
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(AppError::storage)?;
    fs::rename(&tmp, file).map_err(AppError::storage)
}

pub fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or_default()
}
