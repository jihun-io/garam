//! GitHub sign-in and REST API client for Garam.
//!
//! Sign-in uses the OAuth device flow: it needs only the public client ID,
//! so no secret has to ship inside the open source app. This crate doesn't
//! store tokens; the app keeps them in the OS keychain.

mod api;
mod device;
mod error;
mod pulls;

use std::time::Duration;

pub use api::{Email, User};
pub use device::DeviceCode;
pub use error::{ErrorKind, GitHubError, Validation};
pub use pulls::{
    CheckState, Checks, CreatedPullRequest, NewPullRequest, PullRequest, PullRequestState, RepoId,
    RepoRef, Repository, ReviewDecision,
};

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
    graphql_url: String,
    client_id: String,
}

impl Client {
    pub fn github_com() -> Self {
        Self::new("https://github.com", "https://api.github.com", CLIENT_ID)
    }

    /// The client for `host`: github.com, or a GitHub Enterprise Server,
    /// whose API lives under `/api/v3` and `/api/graphql` on the same host.
    pub fn for_host(host: &str) -> Self {
        if host.eq_ignore_ascii_case("github.com") {
            return Self::github_com();
        }
        Self::enterprise(&format!("https://{host}"))
    }

    /// A GitHub Enterprise Server at `web_url`.
    pub fn enterprise(web_url: &str) -> Self {
        let web_url = web_url.trim_end_matches('/');
        let mut client = Self::new(web_url, &format!("{web_url}/api/v3"), CLIENT_ID);
        client.graphql_url = format!("{web_url}/api/graphql");
        client
    }

    /// A client for other URLs (a test server). GraphQL is at
    /// `<api_url>/graphql`, as on github.com.
    pub fn new(web_url: &str, api_url: &str, client_id: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(30)))
            // Error statuses carry a body worth reading; check them by hand.
            .http_status_as_error(false)
            .user_agent(concat!("Garam/", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        let api_url = api_url.trim_end_matches('/').to_owned();
        Self {
            agent,
            web_url: web_url.trim_end_matches('/').to_owned(),
            graphql_url: format!("{api_url}/graphql"),
            api_url,
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

    /// Where the user makes a personal access token with Garam's scopes,
    /// for hosts where the device flow isn't available.
    pub fn new_token_url(&self) -> String {
        format!(
            "{}/settings/tokens/new?description=Garam&scopes={}",
            self.web_url,
            SCOPES.replace(' ', ",")
        )
    }

    /// The page where the user reviews or revokes Garam's access.
    pub fn authorization_settings_url(&self) -> String {
        format!(
            "{}/settings/connections/applications/{}",
            self.web_url, self.client_id
        )
    }
}
