//! Credential prompts that git and ssh send to the askpass helper.
//!
//! The text is English because of `LC_ALL=C`; this turns it into a kind and
//! a few values so the app can ask in the user's language.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum PromptKind {
    /// HTTPS username.
    Username,
    /// HTTPS password or token.
    Password,
    /// Passphrase of an SSH private key.
    SshPassphrase,
    /// Password for an SSH login.
    SshPassword,
    /// ssh doesn't know the server's host key yet; the answer is "yes" or
    /// nothing.
    HostKey,
    Other,
}

impl PromptKind {
    /// Whether the answer should be typed into a hidden field.
    pub fn is_secret(self) -> bool {
        !matches!(self, Self::Username | Self::HostKey)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CredentialPrompt {
    pub kind: PromptKind,
    /// What the prompt is for: a URL, a key file, `user@host` or a host.
    pub target: Option<String>,
    /// For [`PromptKind::HostKey`], e.g. `ED25519 SHA256:abc...`.
    pub fingerprint: Option<String>,
    /// The prompt as git or ssh wrote it.
    pub text: String,
}

pub fn parse_prompt(text: &str) -> CredentialPrompt {
    let trimmed = text.trim();
    let (kind, target, fingerprint) = if let Some(rest) = trimmed.strip_prefix("Username for ") {
        (PromptKind::Username, quoted(rest), None)
    } else if let Some(rest) = trimmed.strip_prefix("Password for ") {
        (PromptKind::Password, quoted(rest), None)
    } else if let Some(rest) = trimmed.strip_prefix("Enter passphrase for ") {
        let rest = rest.strip_prefix("key ").unwrap_or(rest);
        (PromptKind::SshPassphrase, quoted(rest), None)
    } else if trimmed.contains("continue connecting") {
        let host = trimmed
            .strip_prefix("The authenticity of host ")
            .and_then(quoted)
            // "github.com (140.82.121.3)" → "github.com"
            .map(|h| h.split(" (").next().unwrap_or(&h).to_owned());
        (PromptKind::HostKey, host, host_key_fingerprint(trimmed))
    } else if let Some(target) = trimmed.strip_suffix("'s password:") {
        (PromptKind::SshPassword, Some(target.to_owned()), None)
    } else {
        (PromptKind::Other, None, None)
    };
    CredentialPrompt {
        kind,
        target,
        fingerprint,
        text: text.to_owned(),
    }
}

/// The text between the first pair of `'` or `"` quotes.
fn quoted(s: &str) -> Option<String> {
    let quote = s.chars().find(|c| *c == '\'' || *c == '"')?;
    let start = s.find(quote)? + 1;
    let len = s[start..].find(quote)?;
    Some(s[start..start + len].to_owned())
}

/// `ED25519 key fingerprint is SHA256:abc.` → `ED25519 SHA256:abc`.
fn host_key_fingerprint(text: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (algorithm, rest) = line.split_once(" key fingerprint is ")?;
        Some(format!(
            "{} {}",
            algorithm.trim(),
            rest.trim().trim_end_matches('.')
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_https_prompts() {
        let p = parse_prompt("Username for 'https://github.com': ");
        assert_eq!(p.kind, PromptKind::Username);
        assert_eq!(p.target.as_deref(), Some("https://github.com"));

        let p = parse_prompt("Password for 'https://jihun@github.com': ");
        assert_eq!(p.kind, PromptKind::Password);
        assert_eq!(p.target.as_deref(), Some("https://jihun@github.com"));
        assert!(p.kind.is_secret());
    }

    #[test]
    fn parses_ssh_prompts() {
        let p = parse_prompt("Enter passphrase for key '/Users/me/.ssh/id_ed25519': ");
        assert_eq!(p.kind, PromptKind::SshPassphrase);
        assert_eq!(p.target.as_deref(), Some("/Users/me/.ssh/id_ed25519"));

        let p = parse_prompt("Enter passphrase for \"/home/me/.ssh/id_rsa\": ");
        assert_eq!(p.target.as_deref(), Some("/home/me/.ssh/id_rsa"));

        let p = parse_prompt("git@example.com's password: ");
        assert_eq!(p.kind, PromptKind::SshPassword);
        assert_eq!(p.target.as_deref(), Some("git@example.com"));
    }

    #[test]
    fn parses_host_key_question() {
        let text = "The authenticity of host 'github.com (140.82.121.3)' can't be established.\n\
                    ED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.\n\
                    This key is not known by any other names.\n\
                    Are you sure you want to continue connecting (yes/no/[fingerprint])? ";
        let p = parse_prompt(text);
        assert_eq!(p.kind, PromptKind::HostKey);
        assert_eq!(p.target.as_deref(), Some("github.com"));
        assert_eq!(
            p.fingerprint.as_deref(),
            Some("ED25519 SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU")
        );
        assert!(!p.kind.is_secret());
    }

    #[test]
    fn keeps_unknown_prompts_verbatim() {
        let p = parse_prompt("Verification code: ");
        assert_eq!(p.kind, PromptKind::Other);
        assert_eq!(p.text, "Verification code: ");
        assert!(p.kind.is_secret());
    }
}
