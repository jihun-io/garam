//! Pull requests on github.com: where one can go, which branches have
//! one, and opening a new one. The token stays here; only results go to
//! the frontend.

use std::path::Path;
use std::sync::Arc;

use garam_git::{Git, branch, pull_request, remote};
use garam_github::{
    Client, CreatedPullRequest, NewPullRequest, PullRequest, PullRequestState, RepoId, RepoRef,
};
use serde::Serialize;
use tauri::State;

use crate::accounts::AccountStore;
use crate::error::{AppError, AppResult, blocking};
use crate::repositories::RepositoryStore;

type Repositories<'a> = State<'a, Arc<RepositoryStore>>;
type Accounts<'a> = State<'a, Arc<AccountStore>>;

/// Whether the repository can use pull requests, and where they can go.
#[derive(Debug, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PullRequestContext {
    /// The remote isn't on github.com, or there is no remote.
    Unsupported,
    /// No account is chosen for the repository, or it was signed out.
    /// Only what git knows locally is there.
    NoAccount(LocalRemote),
    /// An account is chosen, but GitHub refused or couldn't be reached
    /// (e.g. the organization hasn't approved Garam). What git knows
    /// locally is there too, so the app can still offer and explain.
    Blocked(BlockedAccess),
    Ready(PullRequestTargets),
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BlockedAccess {
    #[serde(flatten)]
    pub local: LocalRemote,
    pub error: AppError,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalRemote {
    /// The default remote's name, e.g. `origin`.
    pub remote: String,
    /// Its default branch as git last saw it (`refs/remotes/origin/HEAD`);
    /// `None` when git never recorded one.
    pub default_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestTargets {
    /// Where branches are published: the default remote's repository.
    pub head: RepoId,
    /// Repositories a pull request can go to: the parent first for a fork,
    /// then the repository itself.
    pub targets: Vec<PullRequestTarget>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestTarget {
    pub repo: RepoRef,
    /// A local remote that points at it, for comparing with its branches.
    pub remote: Option<String>,
}

/// A local branch's pull request.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchPullRequest {
    pub branch: String,
    pub pull_request: PullRequest,
}

/// The default remote's repository and the account's token, when both are
/// on github.com.
enum Access {
    Unsupported,
    NoAccount {
        remote: String,
    },
    Ready {
        token: String,
        remote: String,
        head: RepoId,
        remotes: Vec<(String, RepoId)>,
    },
}

fn access(
    repositories: &RepositoryStore,
    accounts: &AccountStore,
    repo: &str,
) -> AppResult<Access> {
    let client = Client::github_com();
    let info = remote::info(&Git::locate()?, Path::new(repo))?;
    let remotes: Vec<(String, RepoId)> = info
        .remotes
        .iter()
        .filter_map(|r| Some((r.name.clone(), RepoId::from_remote_url(&r.url)?)))
        .filter(|(_, id)| id.host == client.host())
        .collect();
    let Some((remote, head)) = info
        .default_remote
        .and_then(|name| remotes.iter().find(|(n, _)| *n == name))
        .cloned()
    else {
        return Ok(Access::Unsupported);
    };
    let token = match repositories.account(repo) {
        Some(key) if accounts.get(&key).is_some_and(|a| a.host == head.host) => {
            accounts.token(&key)?
        }
        _ => None,
    };
    Ok(match token {
        Some(token) => Access::Ready {
            token,
            remote,
            head,
            remotes,
        },
        None => Access::NoAccount { remote },
    })
}

fn targets(
    client: &Client,
    token: &str,
    head: &RepoId,
    remotes: &[(String, RepoId)],
) -> AppResult<Vec<PullRequestTarget>> {
    let repository = client.repository(token, &head.owner, &head.name)?;
    let local_remote = |repo: &RepoRef| {
        remotes
            .iter()
            .find(|(_, id)| {
                id.owner.eq_ignore_ascii_case(&repo.owner)
                    && id.name.eq_ignore_ascii_case(&repo.name)
            })
            .map(|(name, _)| name.clone())
    };
    Ok(repository
        .parent
        .into_iter()
        .chain([repository.repo])
        .map(|repo| PullRequestTarget {
            remote: local_remote(&repo),
            repo,
        })
        .collect())
}

fn local_remote(repo: &str, remote: String) -> AppResult<LocalRemote> {
    let default_branch = remote::default_branch(&Git::locate()?, Path::new(repo), &remote)?;
    Ok(LocalRemote {
        remote,
        default_branch,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn pull_request_context(
    repositories: Repositories<'_>,
    accounts: Accounts<'_>,
    repo: String,
) -> AppResult<PullRequestContext> {
    let (repositories, accounts) = (Arc::clone(&repositories), Arc::clone(&accounts));
    blocking(move || {
        Ok(match access(&repositories, &accounts, &repo)? {
            Access::Unsupported => PullRequestContext::Unsupported,
            Access::NoAccount { remote } => {
                PullRequestContext::NoAccount(local_remote(&repo, remote)?)
            }
            Access::Ready {
                token,
                remote,
                head,
                remotes,
            } => match targets(&Client::github_com(), &token, &head, &remotes) {
                Ok(targets) => PullRequestContext::Ready(PullRequestTargets { head, targets }),
                Err(error) => PullRequestContext::Blocked(BlockedAccess {
                    local: local_remote(&repo, remote)?,
                    error,
                }),
            },
        })
    })
    .await
}

/// Pull requests of the local branches, for badges: open ones for every
/// branch, and the latest in any state for the current branch. Empty when
/// the repository can't use pull requests.
#[tauri::command]
#[specta::specta]
pub async fn pull_request_list(
    repositories: Repositories<'_>,
    accounts: Accounts<'_>,
    repo: String,
) -> AppResult<Vec<BranchPullRequest>> {
    let (repositories, accounts) = (Arc::clone(&repositories), Arc::clone(&accounts));
    blocking(move || {
        let Access::Ready {
            token,
            head,
            remotes,
            ..
        } = access(&repositories, &accounts, &repo)?
        else {
            return Ok(Vec::new());
        };
        let client = Client::github_com();
        let targets = targets(&client, &token, &head, &remotes)?;
        let upstreams = branch::upstreams(&Git::locate()?, Path::new(&repo))?;
        let owner_of = |remote: &str| {
            remotes
                .iter()
                .find(|(name, _)| name == remote)
                .map(|(_, id)| id.owner.clone())
        };

        let mut open = Vec::new();
        for target in &targets {
            open.extend(client.open_pull_requests(
                &token,
                &target.repo.owner,
                &target.repo.name,
            )?);
        }
        let mut result = Vec::new();
        for upstream in &upstreams {
            let Some(owner) = owner_of(&upstream.remote) else {
                continue;
            };
            let found = if upstream.is_head {
                let mut all = Vec::new();
                for target in &targets {
                    all.extend(client.pull_requests_for_branch(
                        &token,
                        &target.repo.owner,
                        &target.repo.name,
                        &owner,
                        &upstream.remote_branch,
                    )?);
                }
                latest(all)
            } else {
                open.iter()
                    .find(|pr| {
                        pr.head_branch == upstream.remote_branch
                            && pr
                                .head_owner
                                .as_deref()
                                .is_some_and(|o| o.eq_ignore_ascii_case(&owner))
                    })
                    .cloned()
            };
            if let Some(pull_request) = found {
                result.push(BranchPullRequest {
                    branch: upstream.branch.clone(),
                    pull_request,
                });
            }
        }
        Ok(result)
    })
    .await
}

/// An open pull request if there is one, else the newest.
fn latest(mut list: Vec<PullRequest>) -> Option<PullRequest> {
    list.sort_by_key(|pr| {
        (
            pr.state != PullRequestState::Open,
            std::cmp::Reverse(pr.number),
        )
    });
    list.into_iter().next()
}

/// The pull request template on `base` (a full ref or commit id).
#[tauri::command]
#[specta::specta]
pub async fn pull_request_template(repo: String, base: String) -> AppResult<Option<String>> {
    blocking(move || {
        Ok(pull_request::template(
            &Git::locate()?,
            Path::new(&repo),
            &base,
        )?)
    })
    .await
}

/// Opens a pull request on `owner/name`. The branch must already be on
/// the remote; the frontend publishes or pushes first.
#[tauri::command]
#[specta::specta]
pub async fn pull_request_create(
    repositories: Repositories<'_>,
    accounts: Accounts<'_>,
    repo: String,
    owner: String,
    name: String,
    pull_request: NewPullRequest,
) -> AppResult<CreatedPullRequest> {
    let (repositories, accounts) = (Arc::clone(&repositories), Arc::clone(&accounts));
    blocking(move || {
        let Access::Ready { token, .. } = access(&repositories, &accounts, &repo)? else {
            return Err(crate::error::AppError::app(
                crate::error::AppErrorKind::GithubNoAccount,
                None,
            ));
        };
        Ok(Client::github_com().create_pull_request(&token, &owner, &name, &pull_request)?)
    })
    .await
}

#[cfg(test)]
mod tests {
    use garam_github::Checks;

    use super::*;

    fn pr(number: u32, state: PullRequestState) -> PullRequest {
        PullRequest {
            number,
            url: String::new(),
            title: String::new(),
            state,
            draft: false,
            head_branch: "feature".into(),
            head_owner: Some("me".into()),
            head_oid: String::new(),
            base_branch: "main".into(),
            checks: Some(Checks::default()),
            review: None,
        }
    }

    #[test]
    fn prefers_an_open_pull_request_then_the_newest() {
        let list = vec![
            pr(3, PullRequestState::Merged),
            pr(1, PullRequestState::Open),
            pr(2, PullRequestState::Closed),
        ];
        assert_eq!(latest(list).unwrap().number, 1);
        let list = vec![
            pr(2, PullRequestState::Closed),
            pr(5, PullRequestState::Merged),
        ];
        assert_eq!(latest(list).unwrap().number, 5);
        assert!(latest(Vec::new()).is_none());
    }
}
