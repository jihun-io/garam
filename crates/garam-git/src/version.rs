use std::fmt;

use serde::Serialize;

/// Oldest git release Garam supports.
pub const MIN_GIT_VERSION: GitVersion = GitVersion::new(2, 35, 0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GitVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl GitVersion {
    pub const fn new(major: u32, minor: u32, patch: u32) -> Self {
        Self {
            major,
            minor,
            patch,
        }
    }

    /// Parses the output of `git --version`.
    ///
    /// Accepts vendor suffixes such as `git version 2.39.5 (Apple Git-154)`
    /// or `git version 2.45.1.windows.1`.
    pub fn parse(output: &str) -> Option<Self> {
        let rest = output.trim().strip_prefix("git version ")?;
        let token = rest.split_whitespace().next()?;
        let mut parts = token.split('.').map(|p| {
            let digits: String = p.chars().take_while(char::is_ascii_digit).collect();
            digits.parse::<u32>().ok()
        });
        let major = parts.next()??;
        let minor = parts.next()??;
        let patch = parts.next().flatten().unwrap_or(0);
        Some(Self::new(major, minor, patch))
    }

    pub fn is_supported(&self) -> bool {
        *self >= MIN_GIT_VERSION
    }
}

impl fmt::Display for GitVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_version() {
        assert_eq!(
            GitVersion::parse("git version 2.47.1\n"),
            Some(GitVersion::new(2, 47, 1))
        );
    }

    #[test]
    fn parses_apple_and_windows_suffixes() {
        assert_eq!(
            GitVersion::parse("git version 2.39.5 (Apple Git-154)"),
            Some(GitVersion::new(2, 39, 5))
        );
        assert_eq!(
            GitVersion::parse("git version 2.45.1.windows.1"),
            Some(GitVersion::new(2, 45, 1))
        );
    }

    #[test]
    fn parses_release_candidates_and_missing_patch() {
        assert_eq!(
            GitVersion::parse("git version 2.48.0-rc1"),
            Some(GitVersion::new(2, 48, 0))
        );
        assert_eq!(
            GitVersion::parse("git version 2.40"),
            Some(GitVersion::new(2, 40, 0))
        );
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(GitVersion::parse(""), None);
        assert_eq!(GitVersion::parse("hg version 6.0"), None);
        assert_eq!(GitVersion::parse("git version abc"), None);
    }

    #[test]
    fn checks_minimum_version() {
        assert!(GitVersion::new(2, 35, 0).is_supported());
        assert!(GitVersion::new(3, 0, 0).is_supported());
        assert!(!GitVersion::new(2, 34, 9).is_supported());
    }
}
