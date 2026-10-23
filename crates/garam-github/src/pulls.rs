//! Repositories and pull requests: what the status badges and the
//! "create pull request" dialog need.
//!
//! Reads go through GraphQL so one request brings a pull request's checks
//! and review state. CI state comes from `statusCheckRollup`, not REST's
//! combined status, which reports `pending` for a commit with no checks.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{Client, ErrorKind, GitHubError};

/// A repository on a GitHub host, read from a git remote URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RepoId {
    pub host: String,
    pub owner: String,
    pub name: String,
}

impl RepoId {
    /// Reads `https://[user@]host/owner/name[.git]`,
    /// `ssh://[user@]host[:port]/owner/name[.git]` or
    /// `[user@]host:owner/name[.git]`. `None` for anything else, such as a
    /// local path.
    pub fn from_remote_url(url: &str) -> Option<Self> {
        let url = url.trim();
        let (host, path) = if let Some((scheme, rest)) = url.split_once("://") {
            if !matches!(
                scheme.to_ascii_lowercase().as_str(),
                "https" | "http" | "ssh"
            ) {
                return None;
            }
            let (authority, path) = rest.split_once('/')?;
            let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
            (host.split(':').next()?, path)
        } else {
            // scp-like `git@host:owner/name`; a `/` before the `:` is a path.
            let (authority, path) = url.split_once(':')?;
            if authority.contains('/') || authority.len() < 2 {
                return None;
            }
            (
                authority.rsplit_once('@').map_or(authority, |(_, h)| h),
                path,
            )
        };
        let path = path.trim_matches('/');
        let path = path.strip_suffix(".git").unwrap_or(path);
        let (owner, name) = path.split_once('/')?;
        if host.is_empty() || owner.is_empty() || name.is_empty() || name.contains('/') {
            return None;
        }
        Some(Self {
            host: host.to_ascii_lowercase(),
            owner: owner.to_owned(),
            name: name.to_owned(),
        })
    }
}

/// A repository a pull request can target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RepoRef {
    pub owner: String,
    pub name: String,
    /// `None` for an empty repository.
    pub default_branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub repo: RepoRef,
    /// The repository this one was forked from.
    pub parent: Option<RepoRef>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum PullRequestState {
    Open,
    Closed,
    Merged,
}

/// All checks and commit statuses of a commit, rolled into one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    Pending,
    Success,
    Failure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Checks {
    pub state: Option<CheckState>,
    pub total: u32,
    pub failed: u32,
    pub pending: u32,
}

/// Set only when the base branch requires reviews.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum ReviewDecision {
    Approved,
    ChangesRequested,
    ReviewRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u32,
    pub url: String,
    pub title: String,
    pub state: PullRequestState,
    pub draft: bool,
    pub head_branch: String,
    /// `None` when the head repository (a fork) was deleted.
    pub head_owner: Option<String>,
    /// The last commit of the head branch.
    pub head_oid: String,
    pub base_branch: String,
    /// `None` when the last commit has no checks or statuses at all.
    pub checks: Option<Checks>,
    pub review: Option<ReviewDecision>,
}

/// What a new pull request asks for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NewPullRequest {
    pub title: String,
    pub body: String,
    /// The branch name, or `owner:branch` when it lives in a fork.
    pub head: String,
    pub base: String,
    pub draft: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CreatedPullRequest {
    pub number: u32,
    /// The page on the website.
    pub url: String,
}

/// Open pull requests fetched for the branch list; a repository with more
/// shows badges only on the most recently updated ones.
const OPEN_LIMIT: u32 = 100;
/// Pull requests of one branch, newest first.
const BRANCH_LIMIT: u32 = 20;

const PULL_REQUEST_FIELDS: &str = "
fragment pr on PullRequest {
  number url title state isDraft
  headRefName headRefOid headRepositoryOwner { login }
  baseRefName reviewDecision
  commits(last: 1) { nodes { commit { statusCheckRollup {
    state
    contexts {
      checkRunCountsByState { state count }
      statusContextCountsByState { state count }
    }
  } } } }
}";

impl Client {
    /// Whether the repository is a fork, and of what.
    pub fn repository(
        &self,
        token: &str,
        owner: &str,
        name: &str,
    ) -> Result<Repository, GitHubError> {
        const QUERY: &str = "
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    owner { login } name defaultBranchRef { name }
    parent { owner { login } name defaultBranchRef { name } }
  }
}";
        #[derive(Deserialize)]
        struct Data {
            repository: Option<RawRepo>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RawRepo {
            owner: Login,
            name: String,
            default_branch_ref: Option<Name>,
            parent: Option<Box<RawRepo>>,
        }
        fn convert(raw: RawRepo) -> RepoRef {
            RepoRef {
                owner: raw.owner.login,
                name: raw.name,
                default_branch: raw.default_branch_ref.map(|r| r.name),
            }
        }

        let found: Result<Data, GitHubError> =
            self.graphql(token, QUERY, json!({ "owner": owner, "name": name }));
        let raw = found.and_then(|data| {
            data.repository.ok_or_else(|| GitHubError::GraphQl {
                kind: "NOT_FOUND".into(),
                message: format!("{owner}/{name}"),
            })
        });
        let mut raw = match raw {
            Ok(raw) => raw,
            Err(err) if err.kind() == ErrorKind::NotFound => {
                return Err(self.why_not_found(token, owner, name, err));
            }
            Err(err) => return Err(err),
        };
        let parent = raw.parent.take().map(|p| convert(*p));
        Ok(Repository {
            repo: convert(raw),
            parent,
        })
    }

    /// GraphQL says "not found" also when an organization blocks Garam
    /// (OAuth App access restrictions) or wants SSO for the token. The REST
    /// API says which, so ask it before reporting `err`.
    fn why_not_found(&self, token: &str, owner: &str, name: &str, err: GitHubError) -> GitHubError {
        match self.get::<serde_json::Value>(token, &format!("/repos/{owner}/{name}")) {
            Err(rest)
                if matches!(
                    rest.kind(),
                    ErrorKind::OAuthAppRestricted | ErrorKind::SsoRequired
                ) =>
            {
                rest
            }
            _ => err,
        }
    }

    /// The most recently updated open pull requests.
    pub fn open_pull_requests(
        &self,
        token: &str,
        owner: &str,
        name: &str,
    ) -> Result<Vec<PullRequest>, GitHubError> {
        let query = format!(
            "query($owner: String!, $name: String!, $first: Int!) {{
  repository(owner: $owner, name: $name) {{
    pullRequests(states: OPEN, first: $first, orderBy: {{ field: UPDATED_AT, direction: DESC }}) {{
      nodes {{ ...pr }}
    }}
  }}
}}{PULL_REQUEST_FIELDS}"
        );
        let vars = json!({ "owner": owner, "name": name, "first": OPEN_LIMIT });
        self.pull_request_list(token, &query, vars)
    }

    /// Pull requests from `head_owner`'s `branch` in any state, newest
    /// first. GitHub matches the branch name alone, so same-named branches
    /// of other forks are dropped here.
    pub fn pull_requests_for_branch(
        &self,
        token: &str,
        owner: &str,
        name: &str,
        head_owner: &str,
        branch: &str,
    ) -> Result<Vec<PullRequest>, GitHubError> {
        let query = format!(
            "query($owner: String!, $name: String!, $branch: String!, $first: Int!) {{
  repository(owner: $owner, name: $name) {{
    pullRequests(headRefName: $branch, first: $first, orderBy: {{ field: CREATED_AT, direction: DESC }}) {{
      nodes {{ ...pr }}
    }}
  }}
}}{PULL_REQUEST_FIELDS}"
        );
        let vars = json!({ "owner": owner, "name": name, "branch": branch, "first": BRANCH_LIMIT });
        let mut list = self.pull_request_list(token, &query, vars)?;
        list.retain(|pr| {
            pr.head_owner
                .as_deref()
                .is_some_and(|o| o.eq_ignore_ascii_case(head_owner))
        });
        Ok(list)
    }

    /// Opens a pull request on `owner/name`.
    pub fn create_pull_request(
        &self,
        token: &str,
        owner: &str,
        name: &str,
        pull_request: &NewPullRequest,
    ) -> Result<CreatedPullRequest, GitHubError> {
        #[derive(Deserialize)]
        struct Raw {
            number: u32,
            html_url: String,
        }
        let raw: Raw = self.post(token, &format!("/repos/{owner}/{name}/pulls"), pull_request)?;
        Ok(CreatedPullRequest {
            number: raw.number,
            url: raw.html_url,
        })
    }

    fn pull_request_list(
        &self,
        token: &str,
        query: &str,
        variables: serde_json::Value,
    ) -> Result<Vec<PullRequest>, GitHubError> {
        #[derive(Deserialize)]
        struct Data {
            repository: Option<Repo>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Repo {
            pull_requests: Nodes<RawPullRequest>,
        }

        let data: Data = self.graphql(token, query, variables)?;
        let repo = data.repository.ok_or_else(|| GitHubError::GraphQl {
            kind: "NOT_FOUND".into(),
            message: "repository".into(),
        })?;
        Ok(repo
            .pull_requests
            .nodes
            .into_iter()
            .flatten()
            .map(RawPullRequest::convert)
            .collect())
    }
}

#[derive(Deserialize)]
struct Login {
    login: String,
}

#[derive(Deserialize)]
struct Name {
    name: String,
}

#[derive(Deserialize)]
struct Nodes<T> {
    // GraphQL lists may hold nulls (e.g. a node hidden from the viewer).
    nodes: Vec<Option<T>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPullRequest {
    number: u32,
    url: String,
    title: String,
    state: String,
    is_draft: bool,
    head_ref_name: String,
    head_ref_oid: String,
    head_repository_owner: Option<Login>,
    base_ref_name: String,
    review_decision: Option<String>,
    commits: Nodes<CommitNode>,
}

#[derive(Deserialize)]
struct CommitNode {
    commit: Commit,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Commit {
    status_check_rollup: Option<Rollup>,
}

#[derive(Deserialize)]
struct Rollup {
    state: String,
    contexts: Contexts,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contexts {
    #[serde(default)]
    check_run_counts_by_state: Vec<StateCount>,
    #[serde(default)]
    status_context_counts_by_state: Vec<StateCount>,
}

#[derive(Deserialize)]
struct StateCount {
    state: String,
    count: u32,
}

impl RawPullRequest {
    fn convert(self) -> PullRequest {
        let state = match self.state.as_str() {
            "MERGED" => PullRequestState::Merged,
            "CLOSED" => PullRequestState::Closed,
            _ => PullRequestState::Open,
        };
        let review = match self.review_decision.as_deref() {
            Some("APPROVED") => Some(ReviewDecision::Approved),
            Some("CHANGES_REQUESTED") => Some(ReviewDecision::ChangesRequested),
            Some("REVIEW_REQUIRED") => Some(ReviewDecision::ReviewRequired),
            _ => None,
        };
        let checks = self
            .commits
            .nodes
            .into_iter()
            .flatten()
            .next()
            .and_then(|node| node.commit.status_check_rollup)
            .map(Rollup::convert);
        PullRequest {
            number: self.number,
            url: self.url,
            title: self.title,
            state,
            draft: self.is_draft,
            head_branch: self.head_ref_name,
            head_owner: self.head_repository_owner.map(|o| o.login),
            head_oid: self.head_ref_oid,
            base_branch: self.base_ref_name,
            checks,
            review,
        }
    }
}

impl Rollup {
    fn convert(self) -> Checks {
        let state = match self.state.as_str() {
            "SUCCESS" => Some(CheckState::Success),
            "FAILURE" | "ERROR" => Some(CheckState::Failure),
            "PENDING" | "EXPECTED" => Some(CheckState::Pending),
            _ => None,
        };
        let mut checks = Checks {
            state,
            ..Checks::default()
        };
        let counts = self
            .contexts
            .check_run_counts_by_state
            .iter()
            .chain(&self.contexts.status_context_counts_by_state);
        for StateCount { state, count } in counts {
            checks.total += count;
            match state.as_str() {
                // Check run states and conclusions, then commit status states.
                "FAILURE" | "TIMED_OUT" | "STARTUP_FAILURE" | "ACTION_REQUIRED" | "CANCELLED"
                | "ERROR" => checks.failed += count,
                "QUEUED" | "IN_PROGRESS" | "PENDING" | "WAITING" | "REQUESTED" | "EXPECTED" => {
                    checks.pending += count;
                }
                _ => {}
            }
        }
        checks
    }
}
