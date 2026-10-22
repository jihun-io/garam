//! OAuth device flow: the app shows a one-time code, the user enters it on
//! GitHub, and the app polls until GitHub hands out a token.
//!
//! <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow>

use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::{Client, GitHubError};

const GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
/// GitHub adds this much to the interval each time it says `slow_down`.
const SLOW_DOWN_STEP: u64 = 5;

/// What the user needs to approve a sign-in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceCode {
    /// Secret for polling; stays in the backend.
    pub device_code: String,
    /// The code the user types on GitHub, e.g. `WDJB-MJHT`.
    pub user_code: String,
    pub verification_uri: String,
    /// Seconds until the codes expire.
    pub expires_in: u32,
    /// Minimum seconds between polls.
    pub interval: u32,
}

#[derive(Deserialize)]
struct RawDeviceCode {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u32,
    interval: u32,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    interval: Option<u64>,
}

impl Client {
    /// Starts a sign-in.
    pub fn request_device_code(&self, scopes: &str) -> Result<DeviceCode, GitHubError> {
        let mut response = self
            .agent
            .post(format!("{}/login/device/code", self.web_url))
            .header("Accept", "application/json")
            .send_form([("client_id", self.client_id.as_str()), ("scope", scopes)])?;
        let status = response.status().as_u16();
        if status != 200 {
            let body = response.body_mut().read_to_string().unwrap_or_default();
            return Err(GitHubError::Status { status, body });
        }
        let raw: RawDeviceCode = response.body_mut().read_json()?;
        Ok(DeviceCode {
            device_code: raw.device_code,
            user_code: raw.user_code,
            verification_uri: raw.verification_uri,
            expires_in: raw.expires_in,
            interval: raw.interval,
        })
    }

    /// Polls until the user approves (returns the access token), declines,
    /// the code expires, or `is_cancelled` turns true.
    pub fn wait_for_token(
        &self,
        code: &DeviceCode,
        is_cancelled: impl Fn() -> bool,
    ) -> Result<String, GitHubError> {
        let deadline = Instant::now() + Duration::from_secs(code.expires_in.into());
        let mut interval = u64::from(code.interval);
        loop {
            sleep_unless_cancelled(Duration::from_secs(interval), &is_cancelled)?;
            if Instant::now() >= deadline {
                return Err(GitHubError::LoginExpired);
            }
            let response = self.poll_token(&code.device_code)?;
            if let Some(token) = response.access_token {
                return Ok(token);
            }
            match response.error.as_deref() {
                Some("authorization_pending") => {}
                Some("slow_down") => {
                    interval = response.interval.unwrap_or(interval + SLOW_DOWN_STEP);
                }
                Some("expired_token") => return Err(GitHubError::LoginExpired),
                Some("access_denied") => return Err(GitHubError::LoginDenied),
                error => {
                    return Err(GitHubError::OAuth {
                        error: error.unwrap_or_default().to_owned(),
                        description: response.error_description.unwrap_or_default(),
                    });
                }
            }
        }
    }

    fn poll_token(&self, device_code: &str) -> Result<TokenResponse, GitHubError> {
        let mut response = self
            .agent
            .post(format!("{}/login/oauth/access_token", self.web_url))
            .header("Accept", "application/json")
            .send_form([
                ("client_id", self.client_id.as_str()),
                ("device_code", device_code),
                ("grant_type", GRANT_TYPE),
            ])?;
        let status = response.status().as_u16();
        if status != 200 {
            let body = response.body_mut().read_to_string().unwrap_or_default();
            return Err(GitHubError::Status { status, body });
        }
        Ok(response.body_mut().read_json()?)
    }
}

/// Sleeps in short steps so a cancel takes effect quickly.
fn sleep_unless_cancelled(
    total: Duration,
    is_cancelled: &impl Fn() -> bool,
) -> Result<(), GitHubError> {
    let step = Duration::from_millis(100);
    let end = Instant::now() + total;
    loop {
        if is_cancelled() {
            return Err(GitHubError::Cancelled);
        }
        let now = Instant::now();
        if now >= end {
            return Ok(());
        }
        thread::sleep(step.min(end - now));
    }
}
