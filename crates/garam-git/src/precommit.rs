//! Safety checks before a commit: secrets, large files and files that are
//! usually ignored, found in what the commit would add (the index compared
//! with HEAD).
//!
//! Only what this commit brings in is looked at: added lines, changed
//! blobs and newly added files. So a deliberate test key warns once, in the
//! commit that adds it, and there is no "don't ask again" to keep.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::{ChangeKind, FileChange, Git, GitError};

/// Blobs at least this large are reported. GitHub warns from here.
pub const LARGE_FILE: u64 = 50 * 1024 * 1024;
/// GitHub refuses to push blobs larger than this.
pub const GITHUB_FILE_LIMIT: u64 = 100 * 1024 * 1024;
/// Larger blobs aren't read for secrets.
const SCAN_LIMIT: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum SecretKind {
    /// A `.env` file.
    EnvFile,
    /// A file named like a private key (`id_rsa`, `*.pem`, ...).
    KeyFile,
    /// A `-----BEGIN ... PRIVATE KEY-----` line.
    PrivateKey,
    GithubToken,
    AwsKey,
    SlackToken,
    StripeKey,
    GoogleApiKey,
    AnthropicKey,
    OpenaiKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Finding {
    /// Something that looks like a secret. `line` and `preview` (the value
    /// with its middle hidden) are set when it was found in the content.
    Secret {
        path: String,
        secret: SecretKind,
        line: Option<u32>,
        preview: Option<String>,
    },
    /// A blob of at least [`LARGE_FILE`] bytes, `mib` rounded down.
    LargeFile { path: String, mib: u32 },
    /// Newly added files a `.gitignore` line (`pattern`) would leave out.
    Ignorable { pattern: String, paths: Vec<String> },
}

/// One file the commit would change, from `git diff --cached --raw`.
struct Entry {
    status: u8,
    new_mode: String,
    new_oid: String,
    path: String,
}

/// Looks for secrets, large files and usually-ignored files in what the
/// next commit would add.
pub fn check(git: &Git, repo: &Path) -> Result<Vec<Finding>, GitError> {
    let entries = staged_entries(git, repo)?;
    // Submodules have no blob; deletions add nothing.
    let entries: Vec<_> = entries
        .into_iter()
        .filter(|e| e.status != b'D' && e.new_mode != "160000")
        .collect();
    if entries.is_empty() {
        return Ok(Vec::new());
    }
    let sizes = blob_sizes(git, repo, &entries)?;

    let mut secrets = Vec::new();
    let mut large = Vec::new();
    // Not read for secrets: named like one already, or too large to read.
    let mut skip = Vec::new();
    for (entry, &size) in entries.iter().zip(&sizes) {
        if let Some(secret) = secret_name(&entry.path) {
            secrets.push(Finding::Secret {
                path: entry.path.clone(),
                secret,
                line: None,
                preview: None,
            });
            skip.push(entry.path.as_str());
        } else if size > SCAN_LIMIT {
            skip.push(entry.path.as_str());
        }
        if size >= LARGE_FILE {
            large.push(Finding::LargeFile {
                path: entry.path.clone(),
                mib: u32::try_from(size / (1024 * 1024)).unwrap_or(u32::MAX),
            });
        }
    }
    let paths: HashSet<&str> = entries.iter().map(|e| e.path.as_str()).collect();
    secrets.extend(content_secrets(git, repo, &paths, &skip)?);

    let added: Vec<&str> = entries
        .iter()
        .filter(|e| e.status == b'A')
        .map(|e| e.path.as_str())
        .collect();
    let mut findings = secrets;
    findings.extend(large);
    findings.extend(ignorable(repo, &added));
    Ok(findings)
}

fn staged_entries(git: &Git, repo: &Path) -> Result<Vec<Entry>, GitError> {
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["diff", "--cached", "--raw", "-z", "--no-abbrev", "-M"])
        .run()?;
    Ok(parse_raw(&output.stdout_str()))
}

/// Parses `--raw -z` output: `:old new oid oid status\0path\0[path\0]`,
/// with the source path first for renames and copies.
fn parse_raw(output: &str) -> Vec<Entry> {
    let mut fields = output.split('\0');
    let mut entries = Vec::new();
    while let Some(header) = fields.next() {
        let Some(header) = header.strip_prefix(':') else {
            continue;
        };
        let parts: Vec<&str> = header.split(' ').collect();
        let [_, new_mode, _, new_oid, status] = parts[..] else {
            continue;
        };
        let status = status.as_bytes().first().copied().unwrap_or(b'M');
        let Some(first) = fields.next() else { break };
        // The new path follows the source.
        let path = if matches!(status, b'R' | b'C') {
            let Some(second) = fields.next() else { break };
            second.to_owned()
        } else {
            first.to_owned()
        };
        entries.push(Entry {
            status,
            new_mode: new_mode.to_owned(),
            new_oid: new_oid.to_owned(),
            path,
        });
    }
    entries
}

/// The size of each entry's new blob, in order.
fn blob_sizes(git: &Git, repo: &Path, entries: &[Entry]) -> Result<Vec<u64>, GitError> {
    let mut input = String::new();
    for entry in entries {
        input.push_str(&entry.new_oid);
        input.push('\n');
    }
    let output = git
        .command()
        .cwd(repo)
        .read_only()
        .args(["cat-file", "--batch-check=%(objectsize)"])
        .stdin(input)
        .run()?;
    let text = output.stdout_str();
    let mut sizes: Vec<u64> = text
        .lines()
        .map(|l| l.trim().parse().unwrap_or(0))
        .collect();
    sizes.resize(entries.len(), 0);
    Ok(sizes)
}

/// Which secret a file's name alone gives away.
fn secret_name(path: &str) -> Option<SecretKind> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let lower = name.to_ascii_lowercase();
    if lower == ".env"
        || (lower.starts_with(".env.")
            && ![".example", ".sample", ".template"]
                .iter()
                .any(|s| lower.ends_with(s)))
    {
        return Some(SecretKind::EnvFile);
    }
    let key_names = ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"];
    let key_extensions = [".pem", ".key", ".p12", ".pfx"];
    (key_names.contains(&lower.as_str()) || key_extensions.iter().any(|e| lower.ends_with(e)))
        .then_some(SecretKind::KeyFile)
}

/// Secrets in the lines the commit adds, except in `skip`. `paths` are the
/// files the commit changes, to tell which file a patch belongs to.
fn content_secrets(
    git: &Git,
    repo: &Path,
    paths: &HashSet<&str>,
    skip: &[&str],
) -> Result<Vec<Finding>, GitError> {
    // One diff of everything, leaving out the few skipped files, is much
    // faster than naming every file (and `git diff` has no
    // `--pathspec-from-file`, so names would have to go on the command line).
    let mut command = git.command().cwd(repo).read_only().args([
        "diff",
        "--cached",
        "-U0",
        "-M",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
    ]);
    if !skip.is_empty() {
        // Exclusion needs pathspec magic; `literal` keeps each name exact.
        command = command
            .env("GIT_LITERAL_PATHSPECS", "0")
            .args(["--", ":(top)"])
            .args(skip.iter().map(|p| format!(":(top,exclude,literal){p}")));
    }
    let output = command.run()?;
    let text = output.stdout_str();
    let mut findings = Vec::new();
    for patch in split_files(&text) {
        // Matched by the header's new path. A path git has to quote (tabs,
        // quotes, newlines) doesn't match and goes unscanned, which beats
        // reporting a secret against the wrong file.
        let header = patch.lines().next().unwrap_or_default();
        let Some(path) = header
            .match_indices(" b/")
            .map(|(i, _)| &header[i + 3..])
            .find(|p| paths.contains(p))
        else {
            continue;
        };
        for (line, kind, preview) in added_secrets(patch) {
            findings.push(Finding::Secret {
                path: path.to_owned(),
                secret: kind,
                line: Some(line),
                preview: Some(preview),
            });
        }
    }
    Ok(findings)
}

/// Splits a multi-file patch at its `diff --git` headers.
fn split_files(patch: &str) -> Vec<&str> {
    let mut starts: Vec<usize> = Vec::new();
    let mut offset = 0;
    for line in patch.split_inclusive('\n') {
        if line.starts_with("diff --git ") {
            starts.push(offset);
        }
        offset += line.len();
    }
    starts
        .iter()
        .enumerate()
        .map(|(i, &start)| &patch[start..starts.get(i + 1).copied().unwrap_or(patch.len())])
        .collect()
}

/// Secrets on the `+` lines of one file's `-U0` patch, with their line
/// numbers in the new file.
fn added_secrets(patch: &str) -> Vec<(u32, SecretKind, String)> {
    let mut found = Vec::new();
    let mut line_no = 0u32;
    let mut in_hunk = false;
    for line in patch.lines() {
        if let Some(rest) = line.strip_prefix("@@ ") {
            line_no = hunk_new_start(rest);
            in_hunk = true;
        } else if !in_hunk {
            continue;
        } else if let Some(added) = line.strip_prefix('+') {
            if let Some((kind, preview)) = scan_line(added) {
                found.push((line_no, kind, preview));
            }
            line_no += 1;
        }
    }
    found
}

/// The new file's first line number from `-a,b +c,d @@`.
fn hunk_new_start(header: &str) -> u32 {
    header
        .split(' ')
        .find_map(|part| part.strip_prefix('+'))
        .and_then(|range| range.split(',').next())
        .and_then(|start| start.parse().ok())
        .unwrap_or(0)
}

/// A token's prefix, the characters that may follow it, and how many.
struct TokenRule {
    prefix: &'static str,
    kind: SecretKind,
    charset: fn(u8) -> bool,
    min: usize,
    max: usize,
}

fn alnum(b: u8) -> bool {
    b.is_ascii_alphanumeric()
}
fn upper_alnum(b: u8) -> bool {
    b.is_ascii_uppercase() || b.is_ascii_digit()
}
fn alnum_underscore(b: u8) -> bool {
    alnum(b) || b == b'_'
}
fn alnum_dash(b: u8) -> bool {
    alnum(b) || b == b'-'
}
fn base64url(b: u8) -> bool {
    alnum(b) || b == b'-' || b == b'_'
}

const TOKEN_RULES: &[TokenRule] = &[
    // GitHub: ghp_ (classic), gho_ (OAuth), ghu_/ghs_ (apps), ghr_ (refresh).
    TokenRule {
        prefix: "ghp_",
        kind: SecretKind::GithubToken,
        charset: alnum,
        min: 36,
        max: 36,
    },
    TokenRule {
        prefix: "gho_",
        kind: SecretKind::GithubToken,
        charset: alnum,
        min: 36,
        max: 36,
    },
    TokenRule {
        prefix: "ghu_",
        kind: SecretKind::GithubToken,
        charset: alnum,
        min: 36,
        max: 36,
    },
    TokenRule {
        prefix: "ghs_",
        kind: SecretKind::GithubToken,
        charset: alnum,
        min: 36,
        max: 36,
    },
    TokenRule {
        prefix: "ghr_",
        kind: SecretKind::GithubToken,
        charset: alnum,
        min: 36,
        max: 36,
    },
    TokenRule {
        prefix: "github_pat_",
        kind: SecretKind::GithubToken,
        charset: alnum_underscore,
        min: 80,
        max: 90,
    },
    TokenRule {
        prefix: "AKIA",
        kind: SecretKind::AwsKey,
        charset: upper_alnum,
        min: 16,
        max: 16,
    },
    TokenRule {
        prefix: "ASIA",
        kind: SecretKind::AwsKey,
        charset: upper_alnum,
        min: 16,
        max: 16,
    },
    TokenRule {
        prefix: "xoxb-",
        kind: SecretKind::SlackToken,
        charset: alnum_dash,
        min: 20,
        max: 255,
    },
    TokenRule {
        prefix: "xoxp-",
        kind: SecretKind::SlackToken,
        charset: alnum_dash,
        min: 20,
        max: 255,
    },
    TokenRule {
        prefix: "xoxa-",
        kind: SecretKind::SlackToken,
        charset: alnum_dash,
        min: 20,
        max: 255,
    },
    TokenRule {
        prefix: "xoxr-",
        kind: SecretKind::SlackToken,
        charset: alnum_dash,
        min: 20,
        max: 255,
    },
    TokenRule {
        prefix: "xoxs-",
        kind: SecretKind::SlackToken,
        charset: alnum_dash,
        min: 20,
        max: 255,
    },
    TokenRule {
        prefix: "sk_live_",
        kind: SecretKind::StripeKey,
        charset: alnum,
        min: 24,
        max: 255,
    },
    TokenRule {
        prefix: "rk_live_",
        kind: SecretKind::StripeKey,
        charset: alnum,
        min: 24,
        max: 255,
    },
    TokenRule {
        prefix: "AIza",
        kind: SecretKind::GoogleApiKey,
        charset: base64url,
        min: 35,
        max: 35,
    },
    TokenRule {
        prefix: "sk-ant-",
        kind: SecretKind::AnthropicKey,
        charset: base64url,
        min: 32,
        max: 255,
    },
    TokenRule {
        prefix: "sk-proj-",
        kind: SecretKind::OpenaiKey,
        charset: base64url,
        min: 32,
        max: 255,
    },
];

/// The first secret on one added line, and how to show it.
fn scan_line(line: &str) -> Option<(SecretKind, String)> {
    if line.contains("-----BEGIN ") && line.contains("PRIVATE KEY-----") {
        return Some((SecretKind::PrivateKey, line.trim().to_owned()));
    }
    let bytes = line.as_bytes();
    for rule in TOKEN_RULES {
        let mut from = 0;
        while let Some(found) = line[from..].find(rule.prefix) {
            let start = from + found;
            from = start + rule.prefix.len();
            // Inside a longer word (`xAKIA...`) it is something else.
            if start > 0 && base64url(bytes[start - 1]) {
                continue;
            }
            let body = bytes[from..]
                .iter()
                .take_while(|&&b| (rule.charset)(b))
                .count();
            // A longer run of the same characters is not this token either.
            if body < rule.min || body > rule.max {
                continue;
            }
            let token = &line[start..from + body];
            return Some((rule.kind, mask(token)));
        }
    }
    None
}

/// `ghp_abcd…6789`: enough to recognize the value, not to use it.
fn mask(token: &str) -> String {
    let head: String = token.chars().take(4).collect();
    let tail: String = token
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{head}…{tail}")
}

/// Newly added files that are usually ignored, grouped by the `.gitignore`
/// line that would leave them out.
fn ignorable(repo: &Path, added: &[&str]) -> Vec<Finding> {
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    for &path in added {
        let Some(pattern) = ignore_pattern(repo, path) else {
            continue;
        };
        match groups.iter_mut().find(|(p, _)| *p == pattern) {
            Some((_, paths)) => paths.push(path.to_owned()),
            None => groups.push((pattern, vec![path.to_owned()])),
        }
    }
    groups
        .into_iter()
        .map(|(pattern, paths)| Finding::Ignorable { pattern, paths })
        .collect()
}

/// The `.gitignore` line for a usually-ignored file, if it is one.
fn ignore_pattern(repo: &Path, path: &str) -> Option<String> {
    let parts: Vec<&str> = path.split('/').collect();
    let (name, dirs) = parts.split_last()?;
    for (i, &dir) in dirs.iter().enumerate() {
        match dir {
            "node_modules" => return Some("node_modules/".into()),
            "__pycache__" => return Some("__pycache__/".into()),
            _ => {}
        }
        let dir_path = dirs[..=i].join("/");
        // A virtual environment, whatever it is called.
        if repo.join(&dir_path).join("pyvenv.cfg").is_file() {
            return Some(anchored_dir(&dir_path));
        }
        // Cargo's build output, only next to a Cargo.toml.
        let parent = &dirs[..i];
        if dir == "target" && repo.join(parent.join("/")).join("Cargo.toml").is_file() {
            return Some(anchored_dir(&dir_path));
        }
    }
    let lower = name.to_ascii_lowercase();
    match lower.as_str() {
        ".ds_store" => Some(".DS_Store".into()),
        "thumbs.db" => Some("Thumbs.db".into()),
        "desktop.ini" => Some("desktop.ini".into()),
        _ if lower.ends_with(".pyc") => Some("*.pyc".into()),
        _ => None,
    }
}

/// `/dir/path/`: only that folder, relative to the repository root, with
/// the characters `.gitignore` reads as patterns escaped.
fn anchored_dir(dir: &str) -> String {
    let mut out = String::from("/");
    for c in dir.chars() {
        if matches!(c, '\\' | '*' | '?' | '[' | ']' | '!' | '#' | ' ') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('/');
    out
}

/// Adds `patterns` to the root `.gitignore` (creating it, skipping lines it
/// already has), takes `paths` out of the commit and puts `.gitignore` in.
pub fn ignore(
    git: &Git,
    repo: &Path,
    patterns: &[String],
    paths: &[String],
) -> Result<(), GitError> {
    let file = repo.join(".gitignore");
    let mut text = match fs::read_to_string(&file) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };
    let existing: HashSet<&str> = text.lines().map(str::trim).collect();
    let missing: Vec<&String> = patterns
        .iter()
        .filter(|p| !existing.contains(p.as_str()))
        .collect();
    if !missing.is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        for pattern in missing {
            text.push_str(pattern);
            text.push('\n');
        }
        fs::write(&file, text)?;
    }

    let files: Vec<FileChange> = paths
        .iter()
        .map(|path| FileChange {
            path: path.clone(),
            orig_path: None,
            staged: Some(ChangeKind::Added),
            unstaged: None,
            is_submodule: false,
        })
        .collect();
    crate::index::unstage(git, repo, &files)?;
    git.command()
        .cwd(repo)
        .args(["add", "--", ".gitignore"])
        .run()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_tokens_by_shape() {
        let token = format!("ghp_{}", "a".repeat(36));
        let (kind, preview) = scan_line(&format!("TOKEN={token}")).unwrap();
        assert_eq!(kind, SecretKind::GithubToken);
        assert_eq!(preview, "ghp_…aaaa");
        // One character short or long is not a GitHub token.
        assert_eq!(scan_line(&format!("ghp_{}", "a".repeat(35))), None);
        assert_eq!(scan_line(&format!("ghp_{}", "a".repeat(37))), None);
        assert_eq!(
            scan_line("key = \"AKIAIOSFODNN7EXAMPLE\"").map(|f| f.0),
            Some(SecretKind::AwsKey)
        );
        // Part of a longer word.
        assert_eq!(scan_line("xAKIAIOSFODNN7EXAMPLE"), None);
        assert_eq!(scan_line("password = hunter2"), None);
        assert_eq!(
            scan_line("-----BEGIN OPENSSH PRIVATE KEY-----").map(|f| f.0),
            Some(SecretKind::PrivateKey)
        );
        assert_eq!(scan_line("-----BEGIN PUBLIC KEY-----"), None);
    }

    #[test]
    fn names_that_give_secrets_away() {
        assert_eq!(secret_name(".env"), Some(SecretKind::EnvFile));
        assert_eq!(secret_name("app/.env.local"), Some(SecretKind::EnvFile));
        assert_eq!(secret_name(".env.example"), None);
        assert_eq!(secret_name("deploy/id_ed25519"), Some(SecretKind::KeyFile));
        assert_eq!(secret_name("deploy/id_ed25519.pub"), None);
        assert_eq!(secret_name("certs/server.pem"), Some(SecretKind::KeyFile));
        assert_eq!(secret_name("environment.ts"), None);
    }

    #[test]
    fn line_numbers_follow_the_hunks() {
        let patch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,0 +2 @@\n+ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n@@ -9 +10,2 @@\n-old\n+fine\n+AKIAIOSFODNN7EXAMPLE\n";
        let found: Vec<_> = added_secrets(patch)
            .into_iter()
            .map(|f| (f.0, f.1))
            .collect();
        assert_eq!(
            found,
            [(2, SecretKind::GithubToken), (11, SecretKind::AwsKey)]
        );
    }

    #[test]
    fn escapes_anchored_folders() {
        assert_eq!(anchored_dir("tools/target"), "/tools/target/");
        assert_eq!(anchored_dir("my env[1]"), "/my\\ env\\[1\\]/");
    }
}
