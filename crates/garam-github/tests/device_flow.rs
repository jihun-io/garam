use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use garam_github::{Client, ErrorKind};
use mockito::{Matcher, Server};

fn client(server: &Server) -> Client {
    Client::new(&server.url(), &server.url(), "test-client")
}

fn device_code_mock(server: &mut Server) -> mockito::Mock {
    server
        .mock("POST", "/login/device/code")
        .match_body(Matcher::AllOf(vec![
            Matcher::UrlEncoded("client_id".into(), "test-client".into()),
            Matcher::UrlEncoded("scope".into(), "repo user:email".into()),
        ]))
        .with_body(
            r#"{"device_code":"dev-123","user_code":"WDJB-MJHT",
                "verification_uri":"https://github.com/login/device",
                "expires_in":900,"interval":0}"#,
        )
        .create()
}

fn token_mock(server: &mut Server, body: &str) -> mockito::Mock {
    server
        .mock("POST", "/login/oauth/access_token")
        .match_body(Matcher::UrlEncoded("device_code".into(), "dev-123".into()))
        .with_body(body)
        .create()
}

#[test]
fn signs_in_once_the_user_approves() {
    let mut server = Server::new();
    let _code = device_code_mock(&mut server);
    let client = client(&server);

    let code = client.request_device_code("repo user:email").unwrap();
    assert_eq!(code.user_code, "WDJB-MJHT");
    assert_eq!(code.verification_uri, "https://github.com/login/device");

    // Pending twice, then approved.
    let polls = Arc::new(AtomicUsize::new(0));
    let counter = polls.clone();
    let _poll = server
        .mock("POST", "/login/oauth/access_token")
        .match_body(Matcher::UrlEncoded("device_code".into(), "dev-123".into()))
        .with_body_from_request(move |_| {
            if counter.fetch_add(1, Ordering::SeqCst) < 2 {
                br#"{"error":"authorization_pending"}"#.to_vec()
            } else {
                br#"{"access_token":"gho_abc","token_type":"bearer"}"#.to_vec()
            }
        })
        .create();
    let token = client.wait_for_token(&code, || false).unwrap();
    assert_eq!(token, "gho_abc");
    assert_eq!(polls.load(Ordering::SeqCst), 3);
}

#[test]
fn reports_denied_and_expired_codes() {
    let mut server = Server::new();
    let _code = device_code_mock(&mut server);
    let client = client(&server);
    let code = client.request_device_code("repo user:email").unwrap();

    let denied = token_mock(&mut server, r#"{"error":"access_denied"}"#);
    let err = client.wait_for_token(&code, || false).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::LoginDenied);
    denied.remove();

    let _expired = token_mock(&mut server, r#"{"error":"expired_token"}"#);
    let err = client.wait_for_token(&code, || false).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::LoginExpired);
}

#[test]
fn stops_when_cancelled() {
    let mut server = Server::new();
    let _code = device_code_mock(&mut server);
    let client = client(&server);
    let code = client.request_device_code("repo user:email").unwrap();
    let poll = token_mock(&mut server, r#"{"error":"authorization_pending"}"#).expect(0);

    let err = client.wait_for_token(&code, || true).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Cancelled);
    poll.assert();
}

#[test]
fn reads_the_user_and_emails() {
    let mut server = Server::new();
    let _user = server
        .mock("GET", "/user")
        .match_header("authorization", "Bearer gho_abc")
        .with_body(
            r#"{"id":1234,"login":"jihun-io","name":"김지훈",
                "avatar_url":"https://avatars.githubusercontent.com/u/1234"}"#,
        )
        .create();
    let _emails = server
        .mock("GET", "/user/emails")
        .with_body(
            r#"[{"email":"kim@jihun.io","primary":true,"verified":true,"visibility":"private"},
                {"email":"old@example.com","primary":false,"verified":false,"visibility":null}]"#,
        )
        .create();
    let client = client(&server);

    let user = client.user("gho_abc").unwrap();
    assert_eq!(user.login, "jihun-io");
    assert_eq!(user.name.as_deref(), Some("김지훈"));
    assert_eq!(
        user.noreply_email("github.com"),
        "1234+jihun-io@users.noreply.github.com"
    );

    let emails = client.emails("gho_abc").unwrap();
    assert_eq!(emails.len(), 2);
    assert!(emails[0].primary && emails[0].verified);
}

#[test]
fn reads_the_users_organizations() {
    let mut server = Server::new();
    let _orgs = server
        .mock("GET", "/user/orgs")
        .match_query(Matcher::UrlEncoded("per_page".into(), "100".into()))
        .match_header("authorization", "Bearer gho_abc")
        .with_body(
            r#"[{"login":"cw-team","id":1,"description":null},{"login":"garam-dev","id":2}]"#,
        )
        .create();
    let client = client(&server);

    assert_eq!(
        client.organizations("gho_abc").unwrap(),
        ["cw-team", "garam-dev"]
    );
}

#[test]
fn a_revoked_token_is_unauthorized() {
    let mut server = Server::new();
    let _user = server
        .mock("GET", "/user")
        .with_status(401)
        .with_body(r#"{"message":"Bad credentials"}"#)
        .create();
    let err = client(&server).user("gho_old").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Unauthorized);
}

#[test]
fn derives_the_host_and_settings_page() {
    let client = Client::github_com();
    assert_eq!(client.host(), "github.com");
    assert_eq!(
        client.authorization_settings_url(),
        format!(
            "https://github.com/settings/connections/applications/{}",
            garam_github::CLIENT_ID
        )
    );
}
