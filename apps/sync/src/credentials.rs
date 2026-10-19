use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::config::{credentials_path, ensure_home};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub server_url: String,
    pub token: String,
    pub token_id: String,
    pub prefix: String,
    pub name: String,
    pub expires_at: String,
}

impl Credentials {
    pub fn load() -> Result<Option<Self>> {
        let path = credentials_path();
        if !path.exists() {
            return Ok(None);
        }
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("读取登录凭据失败: {}", path.display()))?;
        let credentials = serde_json::from_str(&raw)
            .with_context(|| format!("解析登录凭据失败: {}", path.display()))?;
        Ok(Some(credentials))
    }

    pub fn require() -> Result<Self> {
        Self::load()?.with_context(|| "还没有登录，先运行 `afi login`")
    }

    pub fn save(&self) -> Result<()> {
        ensure_home()?;
        let path = credentials_path();
        let raw = serde_json::to_vec_pretty(self).context("序列化登录凭据失败")?;
        fs::write(&path, raw).with_context(|| format!("写入登录凭据失败: {}", path.display()))?;
        restrict_permissions(&path)?;
        Ok(())
    }

    pub fn delete() -> Result<()> {
        let path = credentials_path();
        if path.exists() {
            fs::remove_file(&path)
                .with_context(|| format!("删除登录凭据失败: {}", path.display()))?;
        }
        Ok(())
    }
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(0o600);
    fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> Result<()> {
    Ok(())
}
