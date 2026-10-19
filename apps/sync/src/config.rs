use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const DEFAULT_STABLE_WAIT_MS: u64 = 2_000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub server_url: String,
    #[serde(default)]
    pub folders: Vec<FolderConfig>,
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    #[serde(default = "default_stable_wait_ms")]
    pub stable_wait_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderConfig {
    pub id: String,
    pub path: String,
    pub name: String,
    pub directory: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub added_at: String,
}

fn default_concurrency() -> usize {
    3
}

fn default_stable_wait_ms() -> u64 {
    DEFAULT_STABLE_WAIT_MS
}

fn default_true() -> bool {
    true
}

impl Config {
    pub fn load() -> Result<Self> {
        let path = config_path();
        if !path.exists() {
            return Ok(Self {
                concurrency: default_concurrency(),
                stable_wait_ms: default_stable_wait_ms(),
                ..Self::default()
            });
        }
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("读取配置失败: {}", path.display()))?;
        let mut config: Self =
            toml::from_str(&raw).with_context(|| format!("解析配置失败: {}", path.display()))?;
        if config.concurrency == 0 {
            config.concurrency = default_concurrency();
        }
        if config.stable_wait_ms == 0 {
            config.stable_wait_ms = default_stable_wait_ms();
        }
        Ok(config)
    }

    pub fn save(&self) -> Result<()> {
        let path = config_path();
        let parent = path.parent().context("配置目录不存在")?;
        fs::create_dir_all(parent)
            .with_context(|| format!("创建目录失败: {}", parent.display()))?;
        let raw = toml::to_string_pretty(self).context("序列化配置失败")?;
        let temp = path.with_extension("toml.tmp");
        fs::write(&temp, raw).with_context(|| format!("写入配置失败: {}", temp.display()))?;
        fs::rename(&temp, &path).with_context(|| format!("保存配置失败: {}", path.display()))?;
        Ok(())
    }

    pub fn add_folder(
        &mut self,
        path: &Path,
        name: Option<String>,
        directory: Option<String>,
        tags: Vec<String>,
    ) -> Result<FolderConfig> {
        let canonical = canonical_dir(path)?;
        let key = canonical.to_string_lossy().to_string();
        if let Some(existing) = self
            .folders
            .iter()
            .find(|folder| same_path(&folder.path, &key))
        {
            bail!(
                "这个文件夹已经在同步列表中: {}",
                display_path(Path::new(&existing.path))
            );
        }

        let folder_name = name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| default_folder_name(&canonical));
        let directory = directory
            .map(|value| sanitize_directory(&value))
            .filter(|value| !value.is_empty())
            .or_else(|| {
                let fallback = sanitize_directory(&default_folder_name(&canonical));
                (!fallback.is_empty()).then_some(fallback)
            })
            .unwrap_or_else(|| "photos".to_string());

        let folder = FolderConfig {
            id: Uuid::new_v4().to_string(),
            path: key,
            name: folder_name,
            directory,
            tags,
            enabled: true,
            added_at: Utc::now().to_rfc3339(),
        };
        self.folders.push(folder.clone());
        Ok(folder)
    }

    pub fn remove_folder(&mut self, path: &Path) -> Result<FolderConfig> {
        let canonical = canonical_dir(path)?;
        let key = canonical.to_string_lossy().to_string();
        let index = self
            .folders
            .iter()
            .position(|folder| same_path(&folder.path, &key))
            .with_context(|| {
                format!(
                    "当前目录未加入同步: {}（先运行 afi add）",
                    display_path(&canonical)
                )
            })?;
        Ok(self.folders.remove(index))
    }

    pub fn find_folder(&self, path: &Path) -> Option<&FolderConfig> {
        let key = path.to_string_lossy();
        self.folders
            .iter()
            .find(|folder| same_path(&folder.path, &key))
    }

    pub fn find_folder_mut(&mut self, path: &Path) -> Option<&mut FolderConfig> {
        let key = path.to_string_lossy();
        self.folders
            .iter_mut()
            .find(|folder| same_path(&folder.path, &key))
    }

    pub fn enabled_folders(&self) -> impl Iterator<Item = &FolderConfig> {
        self.folders.iter().filter(|folder| folder.enabled)
    }
}

pub fn afi_home() -> PathBuf {
    if let Ok(value) = std::env::var("AFI_HOME")
        && !value.trim().is_empty()
    {
        return PathBuf::from(value.trim());
    }
    if let Ok(home) = std::env::var("HOME")
        && !home.trim().is_empty()
    {
        return PathBuf::from(home).join(".afi");
    }
    if let Ok(home) = std::env::var("USERPROFILE")
        && !home.trim().is_empty()
    {
        return PathBuf::from(home).join(".afi");
    }
    PathBuf::from(".afi")
}

pub fn config_path() -> PathBuf {
    afi_home().join("config.toml")
}

pub fn credentials_path() -> PathBuf {
    afi_home().join("credentials.json")
}

pub fn state_path() -> PathBuf {
    afi_home().join("state.sqlite")
}

pub fn control_path() -> PathBuf {
    afi_home().join("control.json")
}

pub fn pid_path() -> PathBuf {
    afi_home().join("daemon.pid")
}

pub fn lock_path() -> PathBuf {
    afi_home().join("daemon.lock")
}

pub fn ensure_home() -> Result<()> {
    let home = afi_home();
    fs::create_dir_all(&home).with_context(|| format!("创建目录失败: {}", home.display()))?;
    Ok(())
}

pub fn write_private(path: &Path, contents: &[u8]) -> Result<()> {
    fs::write(path, contents).with_context(|| format!("写入文件失败: {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

pub fn canonical_dir(path: &Path) -> Result<PathBuf> {
    let canonical =
        fs::canonicalize(path).with_context(|| format!("无法访问文件夹: {}", path.display()))?;
    if !canonical.is_dir() {
        bail!("不是文件夹: {}", path.display());
    }
    Ok(canonical)
}

pub fn same_path(left: &str, right: &str) -> bool {
    let left = fs::canonicalize(left).unwrap_or_else(|_| PathBuf::from(left));
    let right = fs::canonicalize(right).unwrap_or_else(|_| PathBuf::from(right));
    left == right
}

pub fn display_path(path: &Path) -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    if !home.is_empty()
        && let Ok(stripped) = path.strip_prefix(&home)
    {
        let suffix = stripped.to_string_lossy();
        if suffix.is_empty() {
            return "~".to_string();
        }
        return format!("~/{suffix}");
    }
    path.to_string_lossy().to_string()
}

pub fn default_folder_name(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "photos".to_string())
}

pub fn sanitize_directory(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for ch in value.trim().chars() {
        match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '/' => output.push(ch),
            _ => output.push('-'),
        }
    }
    let collapsed = output
        .split('/')
        .map(|segment| segment.trim_matches('-'))
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/");
    collapsed.trim_matches('-').to_string()
}

pub fn normalize_server_url(value: &str) -> Result<String> {
    let trimmed = value.trim().trim_end_matches('/');
    let parsed = url::Url::parse(trimmed).context("服务器地址不合法")?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        bail!("服务器地址必须以 http:// 或 https:// 开头");
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_directory_segments() {
        assert_eq!(sanitize_directory("Camera A7 / 2026"), "Camera-A7/2026");
        assert_eq!(sanitize_directory("../etc/passwd"), "etc/passwd");
        assert_eq!(sanitize_directory("照片"), "");
    }
}
