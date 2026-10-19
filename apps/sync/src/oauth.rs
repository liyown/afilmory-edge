use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};
use tiny_http::{Header, Response, Server, StatusCode};
use url::Url;

use crate::api::ApiClient;
use crate::config::{Config, normalize_server_url};
use crate::credentials::Credentials;

const CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub async fn login(server_url: Option<String>, no_browser: bool) -> Result<Credentials> {
    let mut config = Config::load()?;
    let server = normalize_server_url(server_url.as_deref().unwrap_or(config.server_url.as_str()))
        .context("先运行 `afi login -s https://你的域名`")?;

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).context("无法启动本地回调端口")?;
    let port = listener.local_addr()?.port();
    let server_http = Arc::new(
        Server::from_listener(listener, None)
            .map_err(|error| anyhow::anyhow!("启动回调服务失败: {error}"))?,
    );

    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let state = random_token();
    let verifier = random_token();
    let challenge = code_challenge(&verifier);
    let machine = hostname::get()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Afilmory Sync".to_string());
    let name = format!("{machine} / Afilmory Sync");

    let mut authorize_url =
        Url::parse(&format!("{server}/platform/cli/authorize")).context("服务器地址不合法")?;
    authorize_url
        .query_pairs_mut()
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("name", &name);

    println!("正在打开浏览器授权...");
    println!("如果没有自动打开，请手动访问：");
    println!("{authorize_url}");
    if !no_browser && let Err(error) = webbrowser::open(authorize_url.as_str()) {
        eprintln!("打开浏览器失败: {error}，请手动访问上面的链接");
    }

    let callback_server = Arc::clone(&server_http);
    let expected_state = state.clone();
    let code =
        tokio::task::spawn_blocking(move || wait_for_callback(&callback_server, &expected_state))
            .await
            .context("等待授权回调失败")??;

    let result = ApiClient::exchange_token(&server, &code, &verifier)
        .await
        .context("用授权码换取令牌失败")?;

    let credentials = Credentials {
        server_url: server.clone(),
        token: result.token,
        token_id: result.token_id,
        prefix: result.prefix,
        name: result.name,
        expires_at: result.expires_at,
    };
    credentials.save()?;
    config.server_url = server;
    config.save()?;

    Ok(credentials)
}

fn wait_for_callback(server: &Server, expected_state: &str) -> Result<String> {
    loop {
        let request = server
            .recv_timeout(CALLBACK_TIMEOUT)
            .context("读取回调请求失败")?
            .context("授权超时，请重新运行 `afi login`")?;

        let url =
            Url::parse(&format!("http://127.0.0.1{}", request.url())).context("回调 URL 不合法")?;
        if url.path() != "/callback" {
            let _ = request
                .respond(Response::from_string("Not found").with_status_code(StatusCode(404)));
            continue;
        }

        let params: HashMap<String, String> = url
            .query_pairs()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();

        if params.get("state").map(String::as_str) != Some(expected_state) {
            let _ = request
                .respond(Response::from_string("State mismatch").with_status_code(StatusCode(400)));
            continue;
        }

        if let Some(error) = params.get("error") {
            respond_html(
                request,
                "授权已取消",
                "你可以关闭这个页面，然后重新运行 afi login。",
            );
            bail!("授权已取消: {error}");
        }

        let Some(code) = params.get("code").cloned() else {
            let _ = request
                .respond(Response::from_string("Missing code").with_status_code(StatusCode(400)));
            continue;
        };

        respond_html(request, "授权成功", "可以关闭这个页面，回到终端继续操作。");
        return Ok(code);
    }
}

fn respond_html(request: tiny_http::Request, title: &str, message: &str) {
    let html = format!(
        "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>{title}</title>\
         <body style=\"font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0b0b0c;color:#f5f5f7\">\
         <main style=\"text-align:center\"><h1 style=\"font-size:24px\">{title}</h1><p style=\"color:#a1a1a6\">{message}</p></main></body></html>"
    );
    let header =
        Header::from_bytes("Content-Type", "text/html; charset=utf-8").expect("static header");
    let _ = request.respond(Response::from_string(html).with_header(header));
}

fn random_token() -> String {
    URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>())
}

fn code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_43_chars() {
        let verifier = random_token();
        let challenge = code_challenge(&verifier);
        assert_eq!(challenge.len(), 43);
        assert!(!challenge.contains('='));
    }
}
