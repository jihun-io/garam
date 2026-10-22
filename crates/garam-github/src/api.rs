//! The few REST API calls Garam makes.

use serde::Deserialize;
use serde::de::DeserializeOwned;

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

impl Client {
    /// The signed-in user.
    pub fn user(&self, token: &str) -> Result<User, GitHubError> {
        self.get(token, "/user")
    }

    /// The user's email addresses, including private ones (`user:email`).
    pub fn emails(&self, token: &str) -> Result<Vec<Email>, GitHubError> {
        self.get(token, "/user/emails")
    }

    fn get<T: DeserializeOwned>(&self, token: &str, path: &str) -> Result<T, GitHubError> {
        let mut response = self
            .agent
            .get(format!("{}{path}", self.api_url))
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {token}"))
            .header("X-GitHub-Api-Version", API_VERSION)
            .call()?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            let body = response.body_mut().read_to_string().unwrap_or_default();
            return Err(GitHubError::Status { status, body });
        }
        Ok(response.body_mut().read_json()?)
    }
}
