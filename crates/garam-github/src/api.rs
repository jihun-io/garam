//! The few REST and GraphQL API calls Garam makes.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use ureq::http::Response;
use ureq::{Body, RequestBuilder};

use crate::{Client, GitHubError};

const API_VERSION: &str = "2022-11-28";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct User {
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
}

impl User {
    /// The private address GitHub links to this account, for keeping the
    /// real address out of commits.
    pub fn noreply_email(&self, host: &str) -> String {
        format!("{}+{}@users.noreply.{host}", self.id, self.login)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Email {
    pub email: String,
    pub primary: bool,
    pub verified: bool,
}

#[derive(Deserialize)]
struct Organization {
    login: String,
}

#[derive(Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphQlError>,
}

#[derive(Deserialize)]
struct GraphQlError {
    #[serde(rename = "type", default)]
    kind: String,
    message: String,
}

impl Client {
    /// The signed-in user.
    pub fn user(&self, token: &str) -> Result<User, GitHubError> {
        self.get(token, "/user")
    }

    /// The user's email addresses, including private ones (`user:email`).
    pub fn emails(&self, token: &str) -> Result<Vec<Email>, GitHubError> {
        self.get(token, "/user/emails")
    }

    /// Logins of the organizations the user belongs to, private
    /// memberships included (`read:org`). Only the first 100.
    pub fn organizations(&self, token: &str) -> Result<Vec<String>, GitHubError> {
        let orgs: Vec<Organization> = self.get(token, "/user/orgs?per_page=100")?;
        Ok(orgs.into_iter().map(|o| o.login).collect())
    }

    pub(crate) fn get<T: DeserializeOwned>(
        &self,
        token: &str,
        path: &str,
    ) -> Result<T, GitHubError> {
        let request = self.agent.get(format!("{}{path}", self.api_url));
        read_json(with_auth(request, token).call()?)
    }

    pub(crate) fn post<T: DeserializeOwned>(
        &self,
        token: &str,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, GitHubError> {
        let request = self.agent.post(format!("{}{path}", self.api_url));
        read_json(with_auth(request, token).send_json(body)?)
    }

    /// Runs a GraphQL query. A response with errors fails with the first
    /// one, even when it also carries partial data.
    pub(crate) fn graphql<T: DeserializeOwned>(
        &self,
        token: &str,
        query: &str,
        variables: serde_json::Value,
    ) -> Result<T, GitHubError> {
        let request = self.agent.post(self.graphql_url.as_str());
        let body = serde_json::json!({ "query": query, "variables": variables });
        let response: GraphQlResponse<T> = read_json(with_auth(request, token).send_json(body)?)?;
        if let Some(error) = response.errors.into_iter().next() {
            return Err(GitHubError::GraphQl {
                kind: error.kind,
                message: error.message,
            });
        }
        response
            .data
            .ok_or_else(|| GitHubError::Parse("GraphQL response without data".into()))
    }
}

fn with_auth<B>(request: RequestBuilder<B>, token: &str) -> RequestBuilder<B> {
    request
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
        .header("X-GitHub-Api-Version", API_VERSION)
}

fn read_json<T: DeserializeOwned>(mut response: Response<Body>) -> Result<T, GitHubError> {
    if !response.status().is_success() {
        return Err(status_error(&mut response));
    }
    Ok(response.body_mut().read_json()?)
}

/// The error for a response with an error status, keeping what the app
/// needs to tell the cases apart.
pub(crate) fn status_error(response: &mut Response<Body>) -> GitHubError {
    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    // `X-GitHub-SSO: required; url=https://github.com/orgs/x/sso?...`
    let sso_url = header("x-github-sso").and_then(|value| {
        value
            .split(';')
            .find_map(|part| part.trim().strip_prefix("url=").map(str::to_owned))
    });
    let rate_limited = header("x-ratelimit-remaining").as_deref() == Some("0");
    GitHubError::Status {
        status: response.status().as_u16(),
        body: response.body_mut().read_to_string().unwrap_or_default(),
        sso_url,
        rate_limited,
    }
}
