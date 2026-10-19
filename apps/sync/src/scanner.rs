use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};

use crate::config::FolderConfig;
use crate::inspect::{extension, is_supported, is_video};

const MAX_STABLE_WAIT: Duration = Duration::from_secs(60);
const STABLE_POLL_INTERVAL: Duration = Duration::from_millis(200);

pub fn is_ignored(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.is_empty() {
        return true;
    }
    if name.starts_with('.') || name.starts_with("._") || name.starts_with("~$") {
        return true;
    }
    if name == "@eaDir" || name == "#recycle" {
        return true;
    }
    let lower = name.to_ascii_lowercase();
    [".tmp", ".part", ".partial", ".crdownload"]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
}

pub fn scan_folder(folder: &FolderConfig) -> Result<Vec<PathBuf>> {
    let root = Path::new(&folder.path);
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_ignored(entry.path()))
    {
        let entry = entry.with_context(|| format!("扫描目录失败: {}", root.display()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.into_path();
        if is_supported(&path) && !is_ignored(&path) {
            files.push(path);
        }
    }
    Ok(files)
}

pub fn wait_stable(path: &Path, wait_ms: u64) -> Result<bool> {
    let wait = Duration::from_millis(wait_ms.max(200));
    let started = Instant::now();
    let mut last: Option<(u64, SystemTime)> = None;
    let mut unchanged_since = Instant::now();

    loop {
        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(_) => return Ok(false),
        };
        if !metadata.is_file() {
            return Ok(false);
        }
        let size = metadata.len();
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);

        match last {
            Some((last_size, last_modified)) if last_size == size && last_modified == modified => {
                if unchanged_since.elapsed() >= wait {
                    return Ok(true);
                }
            }
            _ => {
                last = Some((size, modified));
                unchanged_since = Instant::now();
            }
        }

        if started.elapsed() >= MAX_STABLE_WAIT {
            return Ok(false);
        }
        std::thread::sleep(STABLE_POLL_INTERVAL);
    }
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file =
        fs::File::open(path).with_context(|| format!("打开文件失败: {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn photo_id_from_hash(hash: &str) -> Result<String> {
    if hash.len() < 24 {
        anyhow::bail!("内容哈希长度不足");
    }
    let mut value = u128::from_str_radix(&hash[..24], 16).context("解析内容哈希失败")?;
    value |= 1u128 << 95;
    Ok(value.to_string())
}

pub fn paired_video(path: &Path) -> Option<PathBuf> {
    if is_video(path) {
        return None;
    }
    let parent = path.parent()?;
    let stem = path.file_stem()?.to_string_lossy().to_ascii_lowercase();
    let entries = fs::read_dir(parent).ok()?;
    for entry in entries.flatten() {
        let candidate = entry.path();
        if is_video(&candidate)
            && extension(&candidate) == "mov"
            && candidate
                .file_stem()
                .map(|value| value.to_string_lossy().to_ascii_lowercase() == stem)
                .unwrap_or(false)
        {
            return Some(candidate);
        }
    }
    None
}

pub fn relative_parent(folder: &FolderConfig, path: &Path) -> Option<String> {
    let root = Path::new(&folder.path);
    let parent = path.parent()?;
    let relative = parent.strip_prefix(root).ok()?;
    let value = relative.to_string_lossy().replace('\\', "/");
    if value.is_empty() { None } else { Some(value) }
}

pub fn storage_directory(folder: &FolderConfig, path: &Path) -> String {
    match relative_parent(folder, path) {
        Some(relative) => format!("{}/{}", folder.directory.trim_end_matches('/'), relative),
        None => folder.directory.clone(),
    }
}

pub fn file_size(path: &Path) -> Result<u64> {
    Ok(fs::metadata(path)
        .with_context(|| format!("读取文件信息失败: {}", path.display()))?
        .len())
}

pub fn mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn photo_id_is_29_digits_and_stable() {
        let hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let left = photo_id_from_hash(hash).unwrap();
        let right = photo_id_from_hash(hash).unwrap();
        assert_eq!(left, right);
        assert_eq!(left.len(), 29);
        assert!(left.chars().all(|ch| ch.is_ascii_digit()));
    }

    #[test]
    fn ignores_temporary_files() {
        assert!(is_ignored(Path::new(".DS_Store")));
        assert!(is_ignored(Path::new("photo.part")));
        assert!(is_ignored(Path::new("._photo.jpg")));
        assert!(!is_ignored(Path::new("photo.jpg")));
    }
}
