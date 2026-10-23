/// What went wrong, for the app to translate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// GitHub couldn't be reached.
    Network,
    /// The token was revoked or has expired.
    Unauthorized,
    /// The repository doesn't exist, or the account can't see it: GitHub
    /// answers 404 rather than 403 for private repositories.
    NotFound,
    /// The organization blocks OAuth Apps it hasn't approved.
    OAuthAppRestricted,
    /// The organization uses SAML single sign-on and the token isn't
    /// authorized for it yet; [`GitHubError::sso_url`] opens the page.
    SsoRequired,
    /// Too many requests; try again later.
    RateLimited,
    /// GitHub refused the input (422); see [`GitHubError::validation`].
    Validation,
    /// The one-time code expired before the user approved it.
    LoginExpired,
    /// The user declined the authorization.
    LoginDenied,
    /// The sign-in was cancelled in the app.
    Cancelled,
    /// GitHub answered with something unexpected.
    Unexpected,
}

/// The first problem GitHub listed in a 422 response.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Validation {
    /// The input field, e.g. `head` (empty for `custom` errors).
    pub field: String,
    /// `invalid`, `missing`, `already_exists`, `custom`, ...
    pub code: String,
    /// GitHub's own sentence for `custom` errors (English, may change).
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum GitHubError {
    #[error("network error: {0}")]
    Network(String),

    #[error("HTTP {status}: {body}")]
    Status {
        status: u16,
        body: String,
        /// From the `X-GitHub-SSO` header.
        sso_url: Option<String>,
        /// `X-RateLimit-Remaining` was 0.
        rate_limited: bool,
    },

    /// A GraphQL response with errors; `kind` is GitHub's `type`.
    #[error("GraphQL {kind}: {message}")]
    GraphQl { kind: String, message: String },

    #[error("the device code expired")]
    LoginExpired,

    #[error("the user denied access")]
    LoginDenied,

    #[error("cancelled")]
    Cancelled,

    #[error("OAuth error {error}: {description}")]
    OAuth { error: String, description: String },

    #[error("unexpected response: {0}")]
    Parse(String),
}

/// What GitHub says when an organization blocks unapproved OAuth Apps.
const RESTRICTED: &str = "OAuth App access restrictions";

impl GitHubError {
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::Network(_) => ErrorKind::Network,
            Self::Status { status: 401, .. } => ErrorKind::Unauthorized,
            Self::Status {
                status: 403 | 429,
                rate_limited: true,
                ..
            } => ErrorKind::RateLimited,
            Self::Status {
                status: 403,
                sso_url: Some(_),
                ..
            } => ErrorKind::SsoRequired,
            Self::Status {
                status: 403, body, ..
            } if body.contains(RESTRICTED) => ErrorKind::OAuthAppRestricted,
            Self::Status {
                status: 403 | 429,
                body,
                ..
            } if body.contains("rate limit") => ErrorKind::RateLimited,
            Self::Status { status: 404, .. } => ErrorKind::NotFound,
            Self::Status { status: 422, .. } => ErrorKind::Validation,
            Self::GraphQl { kind, .. } if kind == "NOT_FOUND" => ErrorKind::NotFound,
            Self::GraphQl { kind, .. } if kind == "RATE_LIMITED" => ErrorKind::RateLimited,
            Self::GraphQl { message, .. } if message.contains(RESTRICTED) => {
                ErrorKind::OAuthAppRestricted
            }
            Self::LoginExpired => ErrorKind::LoginExpired,
            Self::LoginDenied => ErrorKind::LoginDenied,
            Self::Cancelled => ErrorKind::Cancelled,
            Self::Status { .. } | Self::GraphQl { .. } | Self::OAuth { .. } | Self::Parse(_) => {
                ErrorKind::Unexpected
            }
        }
    }

    /// The page that authorizes the token for an SSO organization.
    pub fn sso_url(&self) -> Option<&str> {
        match self {
            Self::Status {
                sso_url: Some(url), ..
            } => Some(url),
            _ => None,
        }
    }

    /// What a 422 response objected to.
    pub fn validation(&self) -> Option<Validation> {
        let Self::Status {
            status: 422, body, ..
        } = self
        else {
            return None;
        };
        let value: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
        let first = &value["errors"][0];
        let text = |v: &serde_json::Value| v.as_str().unwrap_or_default().to_owned();
        Some(Validation {
            field: text(&first["field"]),
            code: text(&first["code"]),
            message: text(&first["message"]),
        })
    }

    /// Raw text for a "details" toggle.
    pub fn detail(&self) -> String {
        self.to_string()
    }
}

impl From<ureq::Error> for GitHubError {
    fn from(err: ureq::Error) -> Self {
        match err {
            ureq::Error::Json(e) => Self::Parse(e.to_string()),
            e => Self::Network(e.to_string()),
        }
    }
}
