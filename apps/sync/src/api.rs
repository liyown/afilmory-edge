use std::collections::HashMap;
use std::time::Duration;

use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::credentials::Credentials;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("HTTP {status}: {message}")]
    Http { status: u16, message: String },
    #[error(transparent)]
    Request(#[from] reqwest::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl ApiError {
    pub fn status(&self) -> Option<u16> {
        match self {
            Self::Http { status, .. } => Some(*status),
            Self::Request(error) => error.status().map(|status| status.as_u16()),
            Self::Json(_) => None,
        }
    }

    pub fn is_retryable(&self) -> bool {
        match self.status() {
            Some(status) => status == 408 || status == 409 || status == 429 || status >= 500,
            None => true,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadPart {
    pub part_number: u32,
    pub url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadIntent {
    pub mode: String,
    pub key: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub url: Option<String>,
    pub upload_id: Option<String>,
    pub parts: Option<Vec<UploadPart>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompletedPart {
    #[serde(rename = "partNumber")]
    pub part_number: u32,
    pub etag: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToneAnalysis {
    pub tone_type: String,
    pub brightness: u32,
    pub contrast: u32,
    pub shadow_ratio: f64,
    pub highlight_ratio: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteUploadInput {
    pub key: String,
    pub photo_id: String,
    pub filename: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub thumb_hash: Option<String>,
    pub tone_analysis: Option<ToneAnalysis>,
    pub taken_at: Option<String>,
    pub upload_id: Option<String>,
    pub parts: Option<Vec<CompletedPart>>,
    pub video_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoAsset {
    pub id: String,
    pub photo_id: String,
}

#[derive(Debug, Deserialize)]
pub struct TokenExchangeResponse {
    pub token: String,
    pub token_id: String,
    pub prefix: String,
    pub name: String,
    pub expires_at: String,
}

#[derive(Clone)]
pub struct ApiClient {
    http: Client,
    base: String,
    token: String,
}

impl ApiClient {
    pub fn new(server_url: &str, token: &str) -> Result<Self> {
        let base = server_url.trim_end_matches('/').to_string();
        let http = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .context("创建 HTTP 客户端失败")?;
        Ok(Self {
            http,
            base,
            token: token.to_string(),
        })
    }

    pub fn from_credentials(credentials: &Credentials) -> Result<Self> {
        Self::new(&credentials.server_url, &credentials.token)
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn upload_client() -> Result<Client> {
        Client::builder()
            .timeout(Duration::from_secs(60 * 60))
            .build()
            .context("创建上传客户端失败")
    }

    pub fn absolute_url(&self, url: &str) -> String {
        if url.starts_with("http://") || url.starts_with("https://") {
            url.to_string()
        } else if url.starts_with('/') {
            format!("{}{}", self.base, url)
        } else {
            format!("{}/{}", self.base, url)
        }
    }

    pub async fn exchange_token(
        server_url: &str,
        code: &str,
        code_verifier: &str,
    ) -> Result<TokenExchangeResponse, ApiError> {
        let base = server_url.trim_end_matches('/');
        let http = Client::builder().timeout(Duration::from_secs(30)).build()?;
        let response = http
            .post(format!("{base}/api/daemon/token"))
            .json(&serde_json::json!({
                "code": code,
                "codeVerifier": code_verifier,
            }))
            .send()
            .await?;
        parse_response(response).await
    }

    pub async fn list_assets(&self) -> Result<Vec<PhotoAsset>, ApiError> {
        let response = self
            .http
            .get(format!("{}/api/photos/assets", self.base))
            .bearer_auth(&self.token)
            .send()
            .await?;
        parse_response(response).await
    }

    pub async fn create_upload_intent(
        &self,
        filename: &str,
        size: u64,
        content_type: Option<&str>,
        directory: &str,
        photo_id: &str,
        thumbnail: bool,
    ) -> Result<UploadIntent, ApiError> {
        let mut body = serde_json::json!({
            "filename": filename,
            "size": size,
            "directory": directory,
            "photoId": photo_id,
        });
        if let Some(content_type) = content_type {
            body["contentType"] = serde_json::Value::String(content_type.to_string());
        }
        if thumbnail {
            body["variant"] = serde_json::Value::String("thumbnail".to_string());
        }

        let response = self
            .http
            .post(format!("{}/api/photos/upload-intent", self.base))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await?;
        parse_response(response).await
    }

    pub async fn complete_upload(
        &self,
        input: &CompleteUploadInput,
    ) -> Result<PhotoAsset, ApiError> {
        let response = self
            .http
            .post(format!("{}/api/photos/upload-complete", self.base))
            .bearer_auth(&self.token)
            .json(input)
            .send()
            .await?;
        parse_response(response).await
    }

    pub async fn update_tags(&self, asset_id: &str, tags: &[String]) -> Result<(), ApiError> {
        let response = self
            .http
            .patch(format!("{}/api/photos/assets/{asset_id}/tags", self.base))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "tags": tags }))
            .send()
            .await?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        Err(parse_error(response).await)
    }

    pub async fn revoke_token(&self, token_id: &str) -> Result<(), ApiError> {
        let response = self
            .http
            .delete(format!("{}/api/daemon/tokens/{token_id}", self.base))
            .bearer_auth(&self.token)
            .send()
            .await?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        Err(parse_error(response).await)
    }
}

async fn parse_response<T: for<'de> Deserialize<'de>>(
    response: reqwest::Response,
) -> Result<T, ApiError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response.json::<T>().await?);
    }
    Err(parse_error(response).await)
}

async fn parse_error(response: reqwest::Response) -> ApiError {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .and_then(|message| message.as_str())
                .map(str::to_string)
        })
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| {
            if text.is_empty() {
                status
                    .canonical_reason()
                    .unwrap_or("request failed")
                    .to_string()
            } else {
                text
            }
        });
    ApiError::Http {
        status: status.as_u16(),
        message,
    }
}
