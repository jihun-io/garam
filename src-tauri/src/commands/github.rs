use std::sync::Arc;

use garam_github::Client;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};

use crate::accounts::{Account, AccountStore};
use crate::error::{AppError, AppErrorKind, AppResult, blocking};
use crate::operations::Operations;

type Store<'a> = State<'a, Arc<AccountStore>>;

/// Tells every window the signed-in accounts changed, since each keeps its
/// own copy of the list.
pub const ACCOUNTS_CHANGED_EVENT: &str = "accounts-changed";

fn accounts_changed(app: &AppHandle) {
    let _ = app.emit(ACCOUNTS_CHANGED_EVENT, ());
}

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
    app: AppHandle,
    store: Store<'_>,
    operations: State<'_, Arc<Operations>>,
    operation_id: String,
    on_code: Channel<SignInCode>,
) -> AppResult<Account> {
    let store = Arc::clone(&store);
    let operations = Arc::clone(&operations);
    let account = blocking(move || {
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
        // Only used to suggest an account; not worth failing sign-in over.
        let orgs = client.organizations(&token).unwrap_or_default();
        let account = Account::new(client.host(), &user, &emails, orgs);
        store.save(account.clone(), &token)?;
        Ok(account)
    })
    .await?;
    accounts_changed(&app);
    Ok(account)
}

/// Signs in to a GitHub Enterprise Server with a personal access token.
/// The device flow needs an OAuth App registered on each server, so a
/// token the user makes there stands in for it. `host` may be pasted as a
/// URL; only its host name is kept.
#[tauri::command]
#[specta::specta]
pub async fn github_sign_in_with_token(
    app: AppHandle,
    store: Store<'_>,
    host: String,
    token: String,
) -> AppResult<Account> {
    let store = Arc::clone(&store);
    let account = blocking(move || {
        let host = enterprise_host(&host)?;
        let token = token.trim();
        let client = Client::for_host(&host);
        let user = client.user(token)?;
        // A token without `user:email` can't list emails; the noreply
        // address still works for the author.
        let emails = client.emails(token).unwrap_or_default();
        let orgs = client.organizations(token).unwrap_or_default();
        let account = Account::new(client.host(), &user, &emails, orgs);
        store.save(account.clone(), token)?;
        Ok(account)
    })
    .await?;
    accounts_changed(&app);
    Ok(account)
}

/// The page on `host` that makes a token with the scopes Garam needs.
#[tauri::command]
#[specta::specta]
pub fn github_new_token_url(host: String) -> AppResult<String> {
    Ok(Client::for_host(&enterprise_host(&host)?).new_token_url())
}

/// The host name in what the user typed: `git.example.com`,
/// `https://git.example.com/` or a page on it. github.com has its own
/// sign-in, so it isn't accepted here.
fn enterprise_host(input: &str) -> AppResult<String> {
    let input = input.trim();
    let rest = input.split_once("://").map_or(input, |(_, rest)| rest);
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let valid = !host.is_empty()
        && host != "github.com"
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'));
    if valid {
        Ok(host)
    } else {
        Err(AppError::app(AppErrorKind::GithubInvalidHost, None))
    }
}

/// Signs out: forgets the account and deletes its token from the keychain.
/// The authorization stays on GitHub until the user revokes it there.
#[tauri::command]
#[specta::specta]
pub async fn github_sign_out(app: AppHandle, store: Store<'_>, key: String) -> AppResult<()> {
    let store = Arc::clone(&store);
    blocking(move || store.remove(&key)).await?;
    accounts_changed(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_host_from_what_was_typed() {
        for input in [
            "git.example.com",
            " https://Git.Example.com/ ",
            "https://git.example.com/team/repo?tab=1",
        ] {
            assert_eq!(enterprise_host(input).unwrap(), "git.example.com");
        }
        assert_eq!(enterprise_host("ghe.local:8443").unwrap(), "ghe.local:8443");
        for input in ["", "https://", "github.com", "git example.com", "user@host"] {
            assert!(enterprise_host(input).is_err(), "{input}");
        }
    }
}
