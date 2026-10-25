use garam_github::{
    CheckState, Client, ErrorKind, NewPullRequest, PullRequestState, RepoId, ReviewDecision,
};
use mockito::{Matcher, Server};

fn client(server: &Server) -> Client {
    Client::new(&server.url(), &server.url(), "test-client")
}

fn graphql(server: &mut Server, query_part: &str, body: &str) -> mockito::Mock {
    server
        .mock("POST", "/graphql")
        .match_header("authorization", "Bearer gho_test")
        .match_body(Matcher::Regex(regex_escape(query_part)))
        .with_header("content-type", "application/json")
        .with_body(body)
        .create()
}

fn regex_escape(text: &str) -> String {
    text.chars()
        .flat_map(|c| {
            let special = "\\.+*?()|[]{}^$".contains(c);
            special.then_some('\\').into_iter().chain([c])
        })
        .collect()
}

fn pull_request_node(number: u32, owner: Option<&str>, state: &str, rollup: &str) -> String {
    let owner = owner.map_or("null".to_owned(), |o| format!(r#"{{"login":"{o}"}}"#));
    format!(
        r#"{{"number":{number},"url":"https://github.com/o/r/pull/{number}","title":"T{number}",
            "state":"{state}","isDraft":false,"headRefName":"feature","headRefOid":"abc",
            "headRepositoryOwner":{owner},"baseRefName":"main","reviewDecision":null,
            "commits":{{"nodes":[{{"commit":{{"statusCheckRollup":{rollup}}}}}]}}}}"#
    )
}

#[test]
fn reads_repository_urls() {
    let id = |url| RepoId::from_remote_url(url).map(|r| (r.host, r.owner, r.name));
    let expect = |h: &str, o: &str, n: &str| Some((h.to_owned(), o.to_owned(), n.to_owned()));
    assert_eq!(
        id("https://github.com/jihun-io/garam.git"),
        expect("github.com", "jihun-io", "garam")
    );
    assert_eq!(
        id("https://me@GitHub.com/owner/repo"),
        expect("github.com", "owner", "repo")
    );
    assert_eq!(
        id("git@github.com:owner/repo.git"),
        expect("github.com", "owner", "repo")
    );
    assert_eq!(
        id("ssh://git@github.com:22/owner/repo.git/"),
        expect("github.com", "owner", "repo")
    );
    assert_eq!(
        id("https://gitlab.com/group/repo.git"),
        expect("gitlab.com", "group", "repo")
    );
    assert_eq!(id("/Users/me/repo"), None);
    assert_eq!(id("C:/repos/repo"), None);
    assert_eq!(id("file:///srv/repo.git"), None);
    assert_eq!(id("https://github.com/owner"), None);
}

#[test]
fn reads_a_fork_and_its_parent() {
    let mut server = Server::new();
    let _m = graphql(
        &mut server,
        "repository(owner: $owner, name: $name)",
        r#"{"data":{"repository":{"owner":{"login":"me"},"name":"r","defaultBranchRef":{"name":"main"},
            "parent":{"owner":{"login":"up"},"name":"r","defaultBranchRef":{"name":"dev"},"parent":null}}}}"#,
    );
    let repo = client(&server).repository("gho_test", "me", "r").unwrap();
    assert_eq!(repo.repo.owner, "me");
    let parent = repo.parent.unwrap();
    assert_eq!(
        (parent.owner.as_str(), parent.default_branch.as_deref()),
        ("up", Some("dev"))
    );
}

#[test]
fn asks_an_enterprise_server_at_its_graphql_path() {
    let mut server = Server::new();
    let m = server
        .mock("POST", "/api/graphql")
        .match_header("authorization", "Bearer gho_test")
        .with_header("content-type", "application/json")
        .with_body(
            r#"{"data":{"repository":{"owner":{"login":"team"},"name":"r","defaultBranchRef":{"name":"main"},"parent":null}}}"#,
        )
        .create();
    let repo = Client::enterprise(&server.url())
        .repository("gho_test", "team", "r")
        .unwrap();
    assert_eq!(repo.repo.owner, "team");
    m.assert();
}

#[test]
fn a_missing_repository_is_not_found() {
    let mut server = Server::new();
    let _m = graphql(
        &mut server,
        "repository",
        r#"{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","path":["repository"],
            "message":"Could not resolve to a Repository with the name 'o/r'."}]}"#,
    );
    let err = client(&server)
        .repository("gho_test", "o", "r")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NotFound);
}

#[test]
fn rolls_checks_and_statuses_into_counts() {
    let rollup = r#"{"state":"FAILURE","contexts":{
        "checkRunCountsByState":[{"state":"SUCCESS","count":3},{"state":"FAILURE","count":1},
                                 {"state":"IN_PROGRESS","count":1},{"state":"COMPLETED","count":0}],
        "statusContextCountsByState":[{"state":"ERROR","count":1},{"state":"PENDING","count":2}]}}"#;
    let mut server = Server::new();
    let _m = graphql(
        &mut server,
        "states: OPEN",
        &format!(
            r#"{{"data":{{"repository":{{"pullRequests":{{"nodes":[{},{},null]}}}}}}}}"#,
            pull_request_node(1, Some("me"), "OPEN", rollup),
            pull_request_node(2, None, "OPEN", "null"),
        ),
    );
    let list = client(&server)
        .open_pull_requests("gho_test", "o", "r")
        .unwrap();
    assert_eq!(list.len(), 2);
    let checks = list[0].checks.unwrap();
    assert_eq!(checks.state, Some(CheckState::Failure));
    assert_eq!((checks.total, checks.failed, checks.pending), (8, 2, 3));
    // No checks at all is "nothing to show", not "pending".
    assert_eq!(list[1].checks, None);
    assert_eq!(list[1].head_owner, None);
}

#[test]
fn branch_lookup_drops_same_named_branches_of_other_forks() {
    let mut server = Server::new();
    let none = "null";
    let _m = graphql(
        &mut server,
        "headRefName: $branch",
        &format!(
            r#"{{"data":{{"repository":{{"pullRequests":{{"nodes":[{},{},{}]}}}}}}}}"#,
            pull_request_node(3, Some("someone"), "OPEN", none),
            pull_request_node(2, Some("ME"), "MERGED", none),
            pull_request_node(1, None, "CLOSED", none),
        ),
    );
    let list = client(&server)
        .pull_requests_for_branch("gho_test", "o", "r", "me", "feature")
        .unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].number, 2);
    assert_eq!(list[0].state, PullRequestState::Merged);
}

#[test]
fn reads_the_review_decision() {
    let mut server = Server::new();
    let node = pull_request_node(1, Some("me"), "OPEN", "null").replace(
        r#""reviewDecision":null"#,
        r#""reviewDecision":"CHANGES_REQUESTED""#,
    );
    let _m = graphql(
        &mut server,
        "states: OPEN",
        &format!(r#"{{"data":{{"repository":{{"pullRequests":{{"nodes":[{node}]}}}}}}}}"#),
    );
    let list = client(&server)
        .open_pull_requests("gho_test", "o", "r")
        .unwrap();
    assert_eq!(list[0].review, Some(ReviewDecision::ChangesRequested));
}

fn new_pull_request() -> NewPullRequest {
    NewPullRequest {
        title: "Add tags".into(),
        body: "Body".into(),
        head: "me:feature".into(),
        base: "main".into(),
        draft: true,
    }
}

#[test]
fn creates_a_pull_request() {
    let mut server = Server::new();
    let _m = server
        .mock("POST", "/repos/up/r/pulls")
        .match_header("authorization", "Bearer gho_test")
        .match_body(Matcher::Json(serde_json::json!({
            "title": "Add tags", "body": "Body", "head": "me:feature", "base": "main", "draft": true
        })))
        .with_status(201)
        .with_body(
            r#"{"number":12,"url":"https://api.github.com/repos/up/r/pulls/12",
                "html_url":"https://github.com/up/r/pull/12"}"#,
        )
        .create();
    let created = client(&server)
        .create_pull_request("gho_test", "up", "r", &new_pull_request())
        .unwrap();
    assert_eq!(created.number, 12);
    assert_eq!(created.url, "https://github.com/up/r/pull/12");
}

fn create_error(status: usize, headers: &[(&str, &str)], body: &str) -> garam_github::GitHubError {
    let mut server = Server::new();
    let mut mock = server
        .mock("POST", "/repos/up/r/pulls")
        .with_status(status)
        .with_body(body);
    for (name, value) in headers {
        mock = mock.with_header(*name, value);
    }
    let _m = mock.create();
    client(&server)
        .create_pull_request("gho_test", "up", "r", &new_pull_request())
        .unwrap_err()
}

#[test]
fn reads_validation_errors() {
    let err = create_error(
        422,
        &[],
        r#"{"message":"Validation Failed","errors":[{"resource":"PullRequest","field":"head","code":"invalid"}]}"#,
    );
    assert_eq!(err.kind(), ErrorKind::Validation);
    let v = err.validation().unwrap();
    assert_eq!(
        (v.field.as_str(), v.code.as_str(), v.message.as_str()),
        ("head", "invalid", "")
    );

    let err = create_error(
        422,
        &[],
        r#"{"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom","message":"No commits between main and feature"}]}"#,
    );
    let v = err.validation().unwrap();
    assert_eq!(v.code, "custom");
    assert_eq!(v.message, "No commits between main and feature");
}

#[test]
fn tells_organization_blocks_apart() {
    let restricted = create_error(
        403,
        &[],
        r#"{"message":"Although you appear to have the correct authorization credentials, the `org` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited."}"#,
    );
    assert_eq!(restricted.kind(), ErrorKind::OAuthAppRestricted);

    let sso = create_error(
        403,
        &[(
            "x-github-sso",
            "required; url=https://github.com/orgs/org/sso?authorization_request=abc",
        )],
        r#"{"message":"Resource protected by organization SAML enforcement."}"#,
    );
    assert_eq!(sso.kind(), ErrorKind::SsoRequired);
    assert_eq!(
        sso.sso_url(),
        Some("https://github.com/orgs/org/sso?authorization_request=abc")
    );

    let limited = create_error(
        403,
        &[("x-ratelimit-remaining", "0")],
        r#"{"message":"API rate limit exceeded"}"#,
    );
    assert_eq!(limited.kind(), ErrorKind::RateLimited);

    let missing = create_error(404, &[], r#"{"message":"Not Found"}"#);
    assert_eq!(missing.kind(), ErrorKind::NotFound);

    let revoked = create_error(401, &[], r#"{"message":"Bad credentials"}"#);
    assert_eq!(revoked.kind(), ErrorKind::Unauthorized);
}

fn not_found_graphql(server: &mut Server) -> mockito::Mock {
    graphql(
        server,
        "repository(owner: $owner, name: $name)",
        r#"{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","path":["repository"],
            "message":"Could not resolve to a Repository with the name 'org/r'."}]}"#,
    )
}

#[test]
fn a_repository_hidden_by_an_organization_block_says_so() {
    let mut server = Server::new();
    let _g = not_found_graphql(&mut server);
    let _r = server
        .mock("GET", "/repos/org/r")
        .with_status(403)
        .with_body(
            r#"{"message":"Although you appear to have the correct authorization credentials, the `org` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited."}"#,
        )
        .create();
    let err = client(&server)
        .repository("gho_test", "org", "r")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::OAuthAppRestricted);
}

#[test]
fn a_repository_that_needs_sso_says_so() {
    let mut server = Server::new();
    let _g = not_found_graphql(&mut server);
    let _r = server
        .mock("GET", "/repos/org/r")
        .with_status(403)
        .with_header(
            "x-github-sso",
            "required; url=https://github.com/orgs/org/sso?x=1",
        )
        .with_body(r#"{"message":"Resource protected by organization SAML enforcement."}"#)
        .create();
    let err = client(&server)
        .repository("gho_test", "org", "r")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::SsoRequired);
    assert_eq!(err.sso_url(), Some("https://github.com/orgs/org/sso?x=1"));
}

#[test]
fn a_repository_missing_everywhere_stays_not_found() {
    let mut server = Server::new();
    let _g = not_found_graphql(&mut server);
    let _r = server
        .mock("GET", "/repos/org/r")
        .with_status(404)
        .with_body(r#"{"message":"Not Found"}"#)
        .create();
    let err = client(&server)
        .repository("gho_test", "org", "r")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NotFound);
}
