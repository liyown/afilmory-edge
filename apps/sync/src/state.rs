use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct FileRecord {
    pub id: i64,
    pub folder_id: String,
    pub path: String,
    pub size: i64,
    pub mtime_ms: i64,
    pub content_hash: Option<String>,
    pub photo_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub asset_id: Option<String>,
    pub attempts: i64,
    pub next_attempt_at: i64,
    pub last_error: Option<String>,
    pub lease_until: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default)]
pub struct Stats {
    pub pending: u64,
    pub uploading: u64,
    pub failed: u64,
    pub done: u64,
    pub duplicate: u64,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct UploadRecord {
    pub content_hash: String,
    pub photo_id: String,
    pub status: String,
    pub asset_id: Option<String>,
    pub storage_key: Option<String>,
    pub video_key: Option<String>,
    pub tags_applied: bool,
}

pub struct State {
    connection: Mutex<Connection>,
}

impl State {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("创建状态目录失败: {}", parent.display()))?;
        }
        let connection = Connection::open(path)
            .with_context(|| format!("打开状态数据库失败: {}", path.display()))?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_id TEXT NOT NULL,
                path TEXT NOT NULL,
                size INTEGER NOT NULL,
                mtime_ms INTEGER NOT NULL,
                content_hash TEXT,
                photo_id TEXT,
                kind TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                asset_id TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                lease_until INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                UNIQUE(folder_id, path)
            );
            CREATE INDEX IF NOT EXISTS idx_files_status ON files(status, next_attempt_at);
            CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id, status);
            CREATE TABLE IF NOT EXISTS uploads (
                content_hash TEXT PRIMARY KEY,
                photo_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                storage_key TEXT,
                asset_id TEXT,
                video_key TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                tags_applied INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );
            "#,
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn recover_expired_leases(&self) -> Result<usize> {
        let now = now_secs();
        let connection = self.connection.lock().expect("state mutex poisoned");
        Ok(connection.execute(
            "UPDATE files SET status = 'pending', lease_until = 0 WHERE status = 'uploading' AND lease_until < ?1",
            params![now],
        )?)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_file(
        &self,
        folder_id: &str,
        path: &Path,
        size: i64,
        mtime_ms: i64,
        content_hash: &str,
        photo_id: &str,
        kind: &str,
    ) -> Result<FileRecord> {
        let path = path.to_string_lossy().to_string();
        let now = now_secs();
        let connection = self.connection.lock().expect("state mutex poisoned");
        connection.execute(
            r#"
            INSERT INTO files (folder_id, path, size, mtime_ms, content_hash, photo_id, kind, status, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8)
            ON CONFLICT(folder_id, path) DO UPDATE SET
                size = excluded.size,
                mtime_ms = excluded.mtime_ms,
                content_hash = excluded.content_hash,
                photo_id = excluded.photo_id,
                kind = excluded.kind,
                status = CASE
                    WHEN files.content_hash = excluded.content_hash AND files.status = 'done' THEN 'done'
                    WHEN files.content_hash = excluded.content_hash AND files.status = 'duplicate' THEN 'duplicate'
                    ELSE 'pending'
                END,
                attempts = 0,
                next_attempt_at = 0,
                last_error = NULL,
                updated_at = excluded.updated_at
            "#,
            params![folder_id, path, size, mtime_ms, content_hash, photo_id, kind, now],
        )?;
        drop(connection);
        self.get_file(folder_id, Path::new(&path))?
            .context("记录文件后无法读回")
    }

    pub fn get_file(&self, folder_id: &str, path: &Path) -> Result<Option<FileRecord>> {
        let path = path.to_string_lossy().to_string();
        let connection = self.connection.lock().expect("state mutex poisoned");
        let record = connection
            .query_row(
                "SELECT id, folder_id, path, size, mtime_ms, content_hash, photo_id, kind, status, asset_id, attempts, next_attempt_at, last_error, lease_until, updated_at FROM files WHERE folder_id = ?1 AND path = ?2",
                params![folder_id, path],
                map_file,
            )
            .optional()?;
        Ok(record)
    }

    pub fn mark_uploading(&self, id: i64) -> Result<()> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        connection.execute(
            "UPDATE files SET status = 'uploading', lease_until = ?1, attempts = attempts + 1, updated_at = ?2 WHERE id = ?3",
            params![now_secs() + 10 * 60, now_secs(), id],
        )?;
        Ok(())
    }

    pub fn mark_done(&self, id: i64, asset_id: &str) -> Result<()> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        connection.execute(
            "UPDATE files SET status = 'done', asset_id = ?1, lease_until = 0, last_error = NULL, updated_at = ?2 WHERE id = ?3",
            params![asset_id, now_secs(), id],
        )?;
        Ok(())
    }

    pub fn mark_duplicate(&self, id: i64, asset_id: &str) -> Result<()> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        connection.execute(
            "UPDATE files SET status = 'duplicate', asset_id = ?1, lease_until = 0, last_error = NULL, updated_at = ?2 WHERE id = ?3",
            params![asset_id, now_secs(), id],
        )?;
        Ok(())
    }

    pub fn mark_failed(&self, id: i64, error: &str, next_attempt_at: i64) -> Result<()> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        connection.execute(
            "UPDATE files SET status = 'failed', last_error = ?1, next_attempt_at = ?2, lease_until = 0, updated_at = ?3 WHERE id = ?4",
            params![error, next_attempt_at, now_secs(), id],
        )?;
        Ok(())
    }

    pub fn upload_record(&self, content_hash: &str) -> Result<Option<UploadRecord>> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        let record = connection
            .query_row(
                "SELECT content_hash, photo_id, status, asset_id, storage_key, video_key, tags_applied FROM uploads WHERE content_hash = ?1",
                params![content_hash],
                |row| {
                    Ok(UploadRecord {
                        content_hash: row.get(0)?,
                        photo_id: row.get(1)?,
                        status: row.get(2)?,
                        asset_id: row.get(3)?,
                        storage_key: row.get(4)?,
                        video_key: row.get(5)?,
                        tags_applied: row.get::<_, i64>(6)? != 0,
                    })
                },
            )
            .optional()?;
        Ok(record)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_upload(
        &self,
        content_hash: &str,
        photo_id: &str,
        kind: &str,
        status: &str,
        storage_key: Option<&str>,
        asset_id: Option<&str>,
        video_key: Option<&str>,
    ) -> Result<()> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        connection.execute(
            r#"
            INSERT INTO uploads (content_hash, photo_id, kind, status, storage_key, asset_id, video_key, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(content_hash) DO UPDATE SET
                status = excluded.status,
                storage_key = COALESCE(excluded.storage_key, uploads.storage_key),
                asset_id = COALESCE(excluded.asset_id, uploads.asset_id),
                video_key = COALESCE(excluded.video_key, uploads.video_key),
                updated_at = excluded.updated_at
            "#,
            params![content_hash, photo_id, kind, status, storage_key, asset_id, video_key, now_secs()],
        )?;
        Ok(())
    }

    pub fn mark_tags_applied(&self, content_hash: &str) -> Result<()> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        connection.execute(
            "UPDATE uploads SET tags_applied = 1, updated_at = ?1 WHERE content_hash = ?2",
            params![now_secs(), content_hash],
        )?;
        Ok(())
    }

    pub fn reset_failed(&self, folder_id: Option<&str>) -> Result<usize> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        let changed = match folder_id {
            Some(folder_id) => connection.execute(
                "UPDATE files SET status = 'pending', attempts = 0, next_attempt_at = 0, last_error = NULL, updated_at = ?1 WHERE status = 'failed' AND folder_id = ?2",
                params![now_secs(), folder_id],
            )?,
            None => connection.execute(
                "UPDATE files SET status = 'pending', attempts = 0, next_attempt_at = 0, last_error = NULL, updated_at = ?1 WHERE status = 'failed'",
                params![now_secs()],
            )?,
        };
        Ok(changed)
    }

    pub fn remove_folder(&self, folder_id: &str) -> Result<()> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        connection.execute("DELETE FROM files WHERE folder_id = ?1", params![folder_id])?;
        Ok(())
    }

    pub fn stats(&self, folder_id: Option<&str>) -> Result<Stats> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        let mut stats = Stats::default();
        let mut statement = connection.prepare(
            "SELECT status, COUNT(*) FROM files WHERE (?1 IS NULL OR folder_id = ?1) GROUP BY status",
        )?;
        let rows = statement.query_map(params![folder_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for row in rows {
            let (status, count) = row?;
            let count = count.max(0) as u64;
            match status.as_str() {
                "pending" => stats.pending = count,
                "uploading" => stats.uploading = count,
                "failed" => stats.failed = count,
                "done" => stats.done = count,
                "duplicate" => stats.duplicate = count,
                _ => {}
            }
        }
        Ok(stats)
    }

    pub fn last_error(&self, folder_id: &str) -> Result<Option<String>> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        let error = connection
            .query_row(
                "SELECT last_error FROM files WHERE folder_id = ?1 AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1",
                params![folder_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(error)
    }
}

fn map_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileRecord> {
    Ok(FileRecord {
        id: row.get(0)?,
        folder_id: row.get(1)?,
        path: row.get(2)?,
        size: row.get(3)?,
        mtime_ms: row.get(4)?,
        content_hash: row.get(5)?,
        photo_id: row.get(6)?,
        kind: row.get(7)?,
        status: row.get(8)?,
        asset_id: row.get(9)?,
        attempts: row.get(10)?,
        next_attempt_at: row.get(11)?,
        last_error: row.get(12)?,
        lease_until: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}
