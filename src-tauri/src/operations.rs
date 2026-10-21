//! Registry of running long operations so the UI can cancel them by id.

use std::collections::HashMap;
use std::sync::Mutex;

use garam_git::CancelToken;

#[derive(Default)]
pub struct Operations(Mutex<HashMap<String, CancelToken>>);

impl Operations {
    /// Registers `id` and returns a guard that unregisters it when dropped.
    pub fn start(&self, id: String) -> OperationGuard<'_> {
        let token = CancelToken::new();
        self.lock().insert(id.clone(), token.clone());
        OperationGuard {
            operations: self,
            id,
            token,
        }
    }

    /// Cancels the operation if it is still running.
    pub fn cancel(&self, id: &str) {
        if let Some(token) = self.lock().get(id) {
            token.cancel();
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, CancelToken>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub struct OperationGuard<'a> {
    operations: &'a Operations,
    id: String,
    pub token: CancelToken,
}

impl Drop for OperationGuard<'_> {
    fn drop(&mut self) {
        self.operations.lock().remove(&self.id);
    }
}
