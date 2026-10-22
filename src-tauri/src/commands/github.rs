use std::sync::Arc;

use garam_github::Client;
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

use crate::accounts::{Account, AccountStore};
use crate::error::{AppResult, blocking};
use crate::operations::Operations;

type Store<'a> = State<'a, Arc<AccountStore>>;

/// The one-time code the user enters on GitHub.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SignInCode {
    pub user_code: String,
    pub verification_uri: String,
    /// Seconds until the code expires.
    pub expires_in: u32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AccountList {
    pub accounts: Vec<Account>,
    /// Where the user can revoke Garam's access on github.com.
    pub authorization_settings_url: String,
}

#[tauri::command]
#[specta::specta]
pub fn github_accounts(store: Store<'_>) -> AccountList {
    AccountList {
        accounts: store.list(),
        authorization_settings_url: Client::github_com().authorization_settings_url(),
    }
}

/// Signs in to github.com with the device flow: sends the code to
/// `on_code`, then waits until the user approves it in the browser. Cancel
/// with `operation_cancel` using the same `operation_id`.
#[tauri::command]
#[specta::specta]
pub async fn github_sign_in(
    store: Store<'_>,
    operations: State<'_, Arc<Operations>>,
    operation_id: String,
    on_code: Channel<SignInCode>,
) -> AppResult<Account> {
    let store = Arc::clone(&store);
    let operations = Arc::clone(&operations);
    blocking(move || {
        let guard = operations.start(operation_id);
        let client = Client::github_com();
        let code = client.request_device_code(garam_github::SCOPES)?;
        // A closed channel means the dialog is gone; keep going regardless.
        let _ = on_code.send(SignInCode {
            user_code: code.user_code.clone(),
            verification_uri: code.verification_uri.clone(),
            expires_in: code.expires_in,
        });
        let token = client.wait_for_token(&code, || guard.token.is_cancelled())?;
        let user = client.user(&token)?;
        let emails = client.emails(&token)?;
        let account = Account::new(client.host(), &user, &emails);
        store.save(account.clone(), &token)?;
        Ok(account)
    })
    .await
}

/// Signs out: forgets the account and deletes its token from the keychain.
/// The authorization stays on GitHub until the user revokes it there.
#[tauri::command]
#[specta::specta]
pub async fn github_sign_out(store: Store<'_>, key: String) -> AppResult<()> {
    let store = Arc::clone(&store);
    blocking(move || store.remove(&key)).await
}
