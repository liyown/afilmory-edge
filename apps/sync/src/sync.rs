use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result};
use reqwest::Client;
use tokio::time::sleep;
use tracing::{info, warn};

use crate::api::{ApiClient, ApiError, CompleteUploadInput};
use crate::config::FolderConfig;
use crate::inspect::{MediaInfo, extension, inspect_file, is_video};
use crate::scanner::{
    file_size, mtime_ms, paired_video, photo_id_from_hash, sha256_file, storage_directory,
    wait_stable,
};
use crate::state::{State, now_secs};
use crate::upload::{upload_path, upload_thumbnail};

const MAX_ATTEMPTS: u32 = 5;

#[derive(Default)]
pub struct RemoteCache {
    assets: Mutex<HashMap<String, String>>,
}

impl RemoteCache {
    pub fn insert(&self, photo_id: String, asset_id: String) {
        self.assets
            .lock()
            .expect("cache mutex poisoned")
            .insert(photo_id, asset_id);
    }

    pub fn get(&self, photo_id: &str) -> Option<String> {
        self.assets
            .lock()
            .expect("cache mutex poisoned")
            .get(photo_id)
            .cloned()
    }
}

pub struct SyncEngine {
    pub api: ApiClient,
    pub http: Client,
    pub state: Arc<State>,
    pub cache: Arc<RemoteCache>,
    stable_wait_ms: AtomicU64,
}

impl SyncEngine {
    pub fn new(api: ApiClient, state: Arc<State>, stable_wait_ms: u64) -> Result<Self> {
        Ok(Self {
            api,
            http: ApiClient::upload_client()?,
            state,
            cache: Arc::new(RemoteCache::default()),
            stable_wait_ms: AtomicU64::new(stable_wait_ms.max(200)),
        })
    }

    pub fn set_stable_wait_ms(&self, stable_wait_ms: u64) {
        self.stable_wait_ms
            .store(stable_wait_ms.max(200), Ordering::Relaxed);
    }

    pub async fn refresh_remote_cache(&self) -> Result<()> {
        let assets = self
            .api
            .list_assets()
            .await
            .context("读取远端照片列表失败")?;
        for asset in assets {
            self.cache.insert(asset.photo_id, asset.id);
        }
        Ok(())
    }

    pub async fn process(&self, folder: &FolderConfig, path: &Path) -> Result<()> {
        let stable_path = path.to_path_buf();
        let stable =
            tokio::task::spawn_blocking(move || wait_stable(&stable_path, 2_000)).await??;
        if !stable {
            warn!(file = %path.display(), "文件没有稳定下来，跳过");
            return Ok(());
        }

        if is_video(path) && extension(path) == "mov" {
            info!(file = %path.display(), "MOV 由配对的图片上传，跳过单独处理");
            return Ok(());
        }

        let size = file_size(path)?;
        let mtime = mtime_ms(path);
        if let Some(existing) = self.state.get_file(&folder.id, path)?
            && matches!(existing.status.as_str(), "done" | "duplicate")
            && existing.size == size as i64
            && existing.mtime_ms == mtime
        {
            if let Some(asset_id) = existing.asset_id {
                self.cache
                    .insert(existing.photo_id.unwrap_or_default(), asset_id);
            }
            return Ok(());
        }
        let hash_path = path.to_path_buf();
        let hash = tokio::task::spawn_blocking(move || sha256_file(&hash_path)).await??;
        let photo_id = photo_id_from_hash(&hash)?;
        let kind = if is_video(path) { "video" } else { "image" };
        let record =
            self.state
                .record_file(&folder.id, path, size as i64, mtime, &hash, &photo_id, kind)?;

        if record.status == "done" || record.status == "duplicate" {
            if let Some(asset_id) = record.asset_id.clone() {
                self.cache.insert(photo_id, asset_id);
            }
            return Ok(());
        }
        if record.status == "uploading" && record.lease_until > now_secs() {
            return Ok(());
        }

        if let Some(asset_id) = self.cache.get(&photo_id) {
            self.state.mark_duplicate(record.id, &asset_id)?;
            self.state.record_upload(
                &hash,
                &photo_id,
                kind,
                "duplicate",
                None,
                Some(&asset_id),
                None,
            )?;
            info!(file = %path.display(), "远端已存在，跳过");
            return Ok(());
        }

        if let Some(upload) = self.state.upload_record(&hash)?
            && matches!(upload.status.as_str(), "done" | "duplicate")
        {
            if let Some(asset_id) = upload.asset_id {
                self.state.mark_duplicate(record.id, &asset_id)?;
                self.cache.insert(photo_id, asset_id);
            }
            return Ok(());
        }

        self.state.mark_uploading(record.id)?;

        let result = if is_video(path) {
            self.upload_standalone_video(folder, path, &hash, &photo_id)
                .await
        } else {
            self.upload_image(folder, path, &hash, &photo_id).await
        };

        match result {
            Ok(asset_id) => {
                self.state.mark_done(record.id, &asset_id)?;
                self.cache.insert(photo_id.clone(), asset_id.clone());
                self.state.record_upload(
                    &hash,
                    &photo_id,
                    kind,
                    "done",
                    None,
                    Some(&asset_id),
                    None,
                )?;
                info!(file = %path.display(), "上传完成");
                Ok(())
            }
            Err(error) => {
                if is_conflict(&error) {
                    let _ = self.refresh_remote_cache().await;
                    if let Some(asset_id) = self.cache.get(&photo_id) {
                        self.state.mark_duplicate(record.id, &asset_id)?;
                        self.state.record_upload(
                            &hash,
                            &photo_id,
                            kind,
                            "duplicate",
                            None,
                            Some(&asset_id),
                            None,
                        )?;
                        return Ok(());
                    }
                }
                let message = format!("{error:#}");
                self.state.mark_failed(record.id, &message, 0)?;
                Err(error)
            }
        }
    }

    async fn upload_image(
        &self,
        folder: &FolderConfig,
        path: &Path,
        hash: &str,
        photo_id: &str,
    ) -> Result<String> {
        let directory = storage_directory(folder, path);
        let filename = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .context("文件名无效")?;

        let video_key = if let Some(video) = paired_video(path) {
            let video_wait_path = video.clone();
            let video_wait_ms = self.stable_wait_ms.load(Ordering::Relaxed);
            let stable =
                tokio::task::spawn_blocking(move || wait_stable(&video_wait_path, video_wait_ms))
                    .await??;
            if !stable {
                anyhow::bail!("Live Photo 视频还没有稳定: {}", video.display());
            }
            let video_hash_path = video.clone();
            let video_hash =
                tokio::task::spawn_blocking(move || sha256_file(&video_hash_path)).await??;
            let video_photo_id = photo_id_from_hash(&video_hash)?;
            let uploaded = upload_path(
                &self.api,
                &self.http,
                &video,
                &directory,
                &video_photo_id,
                false,
            )
            .await?;
            Some(uploaded.intent.key)
        } else {
            None
        };

        let inspect_path = path.to_path_buf();
        let media = tokio::task::spawn_blocking(move || inspect_file(&inspect_path))
            .await
            .context("缩略图任务失败")??;

        if let Some(thumbnail) = media.thumbnail.as_ref()
            && let Err(error) = upload_thumbnail(
                &self.api, &self.http, thumbnail, &filename, &directory, photo_id,
            )
            .await
        {
            warn!(file = %path.display(), %error, "缩略图上传失败，继续上传原图");
        }

        let uploaded =
            upload_path(&self.api, &self.http, path, &directory, photo_id, false).await?;
        let asset = self
            .api
            .complete_upload(&build_complete_input(
                &uploaded, &filename, photo_id, media, video_key,
            ))
            .await
            .context("完成上传失败")?;

        self.apply_tags_if_needed(folder, &asset.id, hash).await?;

        self.state.record_upload(
            hash,
            photo_id,
            "image",
            "done",
            Some(&uploaded.intent.key),
            Some(&asset.id),
            None,
        )?;
        Ok(asset.id)
    }

    async fn upload_standalone_video(
        &self,
        folder: &FolderConfig,
        path: &Path,
        hash: &str,
        photo_id: &str,
    ) -> Result<String> {
        let directory = storage_directory(folder, path);
        let filename = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .context("文件名无效")?;
        let uploaded =
            upload_path(&self.api, &self.http, path, &directory, photo_id, false).await?;
        let asset = self
            .api
            .complete_upload(&CompleteUploadInput {
                key: uploaded.intent.key.clone(),
                photo_id: photo_id.to_string(),
                filename,
                width: None,
                height: None,
                thumb_hash: None,
                tone_analysis: None,
                taken_at: None,
                upload_id: uploaded.intent.upload_id.clone(),
                parts: if uploaded.parts.is_empty() {
                    None
                } else {
                    Some(uploaded.parts.clone())
                },
                video_key: None,
            })
            .await
            .context("完成视频上传失败")?;
        self.apply_tags_if_needed(folder, &asset.id, hash).await?;
        self.state.record_upload(
            hash,
            photo_id,
            "video",
            "done",
            Some(&uploaded.intent.key),
            Some(&asset.id),
            None,
        )?;
        Ok(asset.id)
    }

    async fn apply_tags_if_needed(
        &self,
        folder: &FolderConfig,
        asset_id: &str,
        hash: &str,
    ) -> Result<()> {
        if folder.tags.is_empty() || self.tags_applied(hash)? {
            return Ok(());
        }
        self.api
            .update_tags(asset_id, &folder.tags)
            .await
            .context("写入标签失败")?;
        self.state.mark_tags_applied(hash)?;
        Ok(())
    }

    fn tags_applied(&self, hash: &str) -> Result<bool> {
        Ok(self
            .state
            .upload_record(hash)?
            .map(|record| record.tags_applied)
            .unwrap_or(false))
    }
}

fn build_complete_input(
    uploaded: &crate::upload::UploadedObject,
    filename: &str,
    photo_id: &str,
    media: MediaInfo,
    video_key: Option<String>,
) -> CompleteUploadInput {
    CompleteUploadInput {
        key: uploaded.intent.key.clone(),
        photo_id: photo_id.to_string(),
        filename: filename.to_string(),
        width: media.width,
        height: media.height,
        thumb_hash: media.thumb_hash,
        tone_analysis: media.tone_analysis,
        taken_at: None,
        upload_id: uploaded.intent.upload_id.clone(),
        parts: if uploaded.parts.is_empty() {
            None
        } else {
            Some(uploaded.parts.clone())
        },
        video_key,
    }
}

pub async fn run_job(engine: Arc<SyncEngine>, folder: FolderConfig, path: PathBuf) {
    for attempt in 1..=MAX_ATTEMPTS {
        match engine.process(&folder, &path).await {
            Ok(()) => return,
            Err(error) => {
                let retryable = is_retryable(&error);
                if !retryable || attempt == MAX_ATTEMPTS {
                    warn!(file = %path.display(), %error, "上传失败");
                    return;
                }
                let delay = Duration::from_secs(2u64.saturating_pow(attempt - 1).min(60));
                warn!(
                    file = %path.display(),
                    %error,
                    "上传失败，{} 秒后重试（{attempt}/{MAX_ATTEMPTS}）",
                    delay.as_secs()
                );
                sleep(delay).await;
            }
        }
    }
}

fn is_retryable(error: &anyhow::Error) -> bool {
    error
        .chain()
        .find_map(|cause| cause.downcast_ref::<ApiError>())
        .map(ApiError::is_retryable)
        .unwrap_or(true)
}

fn is_conflict(error: &anyhow::Error) -> bool {
    error
        .chain()
        .find_map(|cause| cause.downcast_ref::<ApiError>())
        .and_then(ApiError::status)
        == Some(409)
}
