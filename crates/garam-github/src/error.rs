/// What went wrong, for the app to translate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// GitHub couldn't be reached.
    Network,
    /// The token was revoked or has expired.
    Unauthorized,
    /// The one-time code expired before the user approved it.
    LoginExpired,
    /// The user declined the authorization.
    LoginDenied,
    /// The sign-in was cancelled in the app.
    Cancelled,
    /// GitHub answered with something unexpected.
    Unexpected,
}

#[derive(Debug, thiserror::Error)]
pub enum GitHubError {
    #[error("network error: {0}")]
    Network(String),

    #[error("HTTP {status}: {body}")]
    Status { status: u16, body: String },

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

impl GitHubError {
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::Network(_) => ErrorKind::Network,
            Self::Status { status: 401, .. } => ErrorKind::Unauthorized,
            Self::LoginExpired => ErrorKind::LoginExpired,
            Self::LoginDenied => ErrorKind::LoginDenied,
            Self::Cancelled => ErrorKind::Cancelled,
            Self::Status { .. } | Self::OAuth { .. } | Self::Parse(_) => ErrorKind::Unexpected,
        }
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
