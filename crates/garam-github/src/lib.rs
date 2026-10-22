//! GitHub sign-in and REST API client for Garam.
//!
//! Sign-in uses the OAuth device flow: it needs only the public client ID,
//! so no secret has to ship inside the open source app. This crate doesn't
//! store tokens; the app keeps them in the OS keychain.

mod api;
mod device;
mod error;

use std::time::Duration;

pub use api::{Email, User};
pub use device::DeviceCode;
pub use error::{ErrorKind, GitHubError};

/// Client ID of Garam's OAuth App on github.com (public by design).
pub const CLIENT_ID: &str = "Ov23liJ32glLdO4R8vgx";

/// Scopes Garam asks for: push and pull private repositories (`repo`),
/// push changes to workflow files (`workflow`), see organization
/// membership to suggest an account per repository (`read:org`), and read
/// the account's emails to suggest a commit author (`user:email`).
pub const SCOPES: &str = "repo workflow read:org user:email";

/// One GitHub host: its website (sign-in) and its REST API.
#[derive(Debug, Clone)]
pub struct Client {
    agent: ureq::Agent,
    web_url: String,
    api_url: String,
    client_id: String,
}

impl Client {
    pub fn github_com() -> Self {
        Self::new("https://github.com", "https://api.github.com", CLIENT_ID)
    }

    /// A client for other URLs (a test server, later GitHub Enterprise).
    pub fn new(web_url: &str, api_url: &str, client_id: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(30)))
            // Error statuses carry a body worth reading; check them by hand.
            .http_status_as_error(false)
            .user_agent(concat!("Garam/", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        Self {
            agent,
            web_url: web_url.trim_end_matches('/').to_owned(),
            api_url: api_url.trim_end_matches('/').to_owned(),
            client_id: client_id.to_owned(),
        }
    }

    /// The host name git uses in remote URLs, e.g. `github.com`.
    pub fn host(&self) -> &str {
        let rest = self
            .web_url
            .split_once("://")
            .map_or(self.web_url.as_str(), |(_, r)| r);
        rest.split('/').next().unwrap_or(rest)
    }

    /// The page where the user reviews or revokes Garam's access.
    pub fn authorization_settings_url(&self) -> String {
        format!(
            "{}/settings/connections/applications/{}",
            self.web_url, self.client_id
        )
    }
}
