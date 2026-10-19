use std::path::Path;

use anyhow::{Context, Result, bail};
use reqwest::Client;
use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE, ETAG, HeaderName, HeaderValue};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

use crate::api::{ApiClient, CompletedPart, UploadIntent};
use crate::inspect::content_type;

const MAX_UPLOAD_BYTES: u64 = 1024 * 1024 * 1024;

pub struct UploadedObject {
    pub intent: UploadIntent,
    pub parts: Vec<CompletedPart>,
}

pub async fn upload_path(
    api: &ApiClient,
    http: &Client,
    path: &Path,
    directory: &str,
    photo_id: &str,
    thumbnail: bool,
) -> Result<UploadedObject> {
    let metadata = tokio::fs::metadata(path)
        .await
        .with_context(|| format!("读取文件信息失败: {}", path.display()))?;
    if metadata.len() > MAX_UPLOAD_BYTES {
        bail!("文件超过 1 GiB 上限: {}", path.display());
    }
    let filename = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .context("文件名无效")?;
    let intent = api
        .create_upload_intent(
            &filename,
            metadata.len(),
            Some(content_type(path)),
            directory,
            photo_id,
            thumbnail,
        )
        .await
        .with_context(|| format!("申请上传失败: {}", path.display()))?;

    let parts = if intent.mode == "multipart" {
        upload_multipart(api, http, path, &intent, metadata.len()).await?
    } else {
        let url = intent.url.as_deref().context("上传意图缺少 URL")?;
        put_file(
            api,
            http,
            path,
            url,
            0,
            metadata.len(),
            &intent.headers,
            false,
        )
        .await?;
        Vec::new()
    };

    Ok(UploadedObject { intent, parts })
}

async fn upload_multipart(
    api: &ApiClient,
    http: &Client,
    path: &Path,
    intent: &UploadIntent,
    size: u64,
) -> Result<Vec<CompletedPart>> {
    let parts = intent.parts.as_ref().context("分片上传缺少 parts")?;
    if parts.is_empty() {
        bail!("分片上传缺少 parts");
    }
    let part_size = size.div_ceil(parts.len() as u64);
    let mut completed = Vec::with_capacity(parts.len());

    for part in parts {
        let start = (part.part_number as u64 - 1) * part_size;
        if start >= size {
            bail!("分片 {} 超出文件大小", part.part_number);
        }
        let end = (start + part_size).min(size);
        let response = put_file(
            api,
            http,
            path,
            &part.url,
            start,
            end - start,
            &intent.headers,
            true,
        )
        .await?;
        let etag = response
            .headers()
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .with_context(|| format!("分片 {} 缺少 ETag", part.part_number))?;
        completed.push(CompletedPart {
            part_number: part.part_number,
            etag,
        });
    }

    Ok(completed)
}

#[allow(clippy::too_many_arguments)]
async fn put_file(
    api: &ApiClient,
    http: &Client,
    path: &Path,
    url: &str,
    offset: u64,
    length: u64,
    intent_headers: &std::collections::HashMap<String, String>,
    require_etag: bool,
) -> Result<reqwest::Response> {
    let mut file = File::open(path)
        .await
        .with_context(|| format!("打开文件失败: {}", path.display()))?;
    if offset > 0 {
        file.seek(std::io::SeekFrom::Start(offset)).await?;
    }
    let reader = file.take(length);
    let stream = ReaderStream::new(reader);
    let body = reqwest::Body::wrap_stream(stream);

    let absolute = api.absolute_url(url);
    let mut request = http
        .put(absolute.clone())
        .header(CONTENT_LENGTH, length)
        .body(body);
    if !url.starts_with("http://") && !url.starts_with("https://") {
        request = request.bearer_auth(api.token());
    }
    for (name, value) in intent_headers {
        if name.eq_ignore_ascii_case("content-length") {
            continue;
        }
        request = request.header(
            HeaderName::from_bytes(name.as_bytes()).context("非法上传 header")?,
            HeaderValue::from_str(value).context("非法上传 header 值")?,
        );
    }
    if !intent_headers
        .keys()
        .any(|name| name.eq_ignore_ascii_case("content-type"))
    {
        request = request.header(CONTENT_TYPE, content_type(path));
    }

    let response = request
        .send()
        .await
        .with_context(|| format!("上传失败: {absolute}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        bail!("上传失败，HTTP {status}: {text}");
    }
    if require_etag && response.headers().get(ETAG).is_none() {
        bail!("对象存储没有返回 ETag，请检查桶的 CORS ExposeHeaders 配置");
    }
    Ok(response)
}

pub async fn upload_thumbnail(
    api: &ApiClient,
    http: &Client,
    bytes: &[u8],
    filename: &str,
    directory: &str,
    photo_id: &str,
) -> Result<()> {
    let intent = api
        .create_upload_intent(
            filename,
            bytes.len() as u64,
            Some("image/jpeg"),
            directory,
            photo_id,
            true,
        )
        .await
        .context("申请缩略图上传失败")?;
    let url = intent.url.as_deref().context("缩略图上传意图缺少 URL")?;
    let absolute = api.absolute_url(url);
    let mut request = http
        .put(absolute.clone())
        .header(CONTENT_LENGTH, bytes.len())
        .header(CONTENT_TYPE, "image/jpeg")
        .body(bytes.to_vec());
    if !url.starts_with("http://") && !url.starts_with("https://") {
        request = request.bearer_auth(api.token());
    }
    let response = request.send().await.context("上传缩略图失败")?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        bail!("上传缩略图失败，HTTP {status}: {text}");
    }
    Ok(())
}
