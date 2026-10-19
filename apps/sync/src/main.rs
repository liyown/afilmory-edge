mod api;
mod cli;
mod config;
mod credentials;
mod daemon;
mod inspect;
mod oauth;
mod output;
mod scanner;
mod state;
mod sync;
mod upload;

use std::io::IsTerminal;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use clap::Parser;
use console::style;
use serde_json::json;
use tracing_subscriber::EnvFilter;

use crate::api::ApiClient;
use crate::cli::{Cli, Command, ServiceAction};
use crate::config::{Config, canonical_dir, display_path};
use crate::credentials::Credentials;
use crate::output::{FolderView, StatusView};
use crate::state::State;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .without_time()
        .init();

    if let Err(error) = run().await {
        eprintln!("{} {error:#}", style("错误:").red().bold());
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Login { server, no_browser } => {
            let credentials = oauth::login(server, no_browser).await?;
            if daemon::is_running().await {
                let _ = daemon::send_control("shutdown").await;
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                daemon::start_detached().await?;
                let _ = daemon::send_control("reload").await;
            }
            println!("{}", style("登录成功").green().bold());
            println!("  服务器: {}", credentials.server_url);
            println!("  令牌: {}", credentials.prefix);
            println!();
            println!(
                "下一步：进入要同步的文件夹，运行 {}",
                style("afi add").bold()
            );
            Ok(())
        }
        Command::Logout { revoke } => logout(revoke).await,
        Command::Add {
            path,
            directory,
            tags,
            name,
            no_start,
        } => add(path, directory, tags, name, no_start).await,
        Command::Ls { json } => list(json).await,
        Command::Rm { path, purge, yes } => remove(path, purge, yes).await,
        Command::St { json } => status(json).await,
        Command::Pause { path } => set_enabled(path, false).await,
        Command::Resume { path } => set_enabled(path, true).await,
        Command::Retry { path } => retry(path).await,
        Command::Daemon => daemon::run().await,
        Command::Service { action } => service(action).await,
        Command::Doctor => doctor().await,
    }
}

async fn add(
    path: Option<PathBuf>,
    directory: Option<String>,
    tags: Vec<String>,
    name: Option<String>,
    no_start: bool,
) -> Result<()> {
    let credentials = Credentials::require()?;
    let path = path.unwrap_or(std::env::current_dir()?);
    let mut config = Config::load()?;
    if config.server_url.trim().is_empty() {
        config.server_url = credentials.server_url.clone();
    } else if config.server_url != credentials.server_url {
        bail!(
            "配置里的服务器 {} 与登录服务器 {} 不一致，先运行 `afi login -s {}`",
            config.server_url,
            credentials.server_url,
            config.server_url
        );
    }
    let folder = config.add_folder(&path, name, directory, tags)?;
    config.save()?;
    output::print_added(&folder);

    if !no_start {
        daemon::start_detached().await?;
    }
    if daemon::is_running().await {
        let _ = daemon::send_control("reload").await;
    }
    Ok(())
}

async fn list(json_output: bool) -> Result<()> {
    let config = Config::load()?;
    let state = State::open(&crate::config::state_path())?;
    let running = daemon::is_running().await;
    let current = std::env::current_dir()
        .ok()
        .and_then(|path| std::fs::canonicalize(path).ok());
    let current_folder_id = current.as_ref().and_then(|path| {
        config
            .folders
            .iter()
            .filter(|folder| path.starts_with(Path::new(&folder.path)))
            .max_by_key(|folder| folder.path.len())
            .map(|folder| folder.id.clone())
    });

    let mut rows = Vec::new();
    for folder in &config.folders {
        let stats = state.stats(Some(&folder.id))?;
        let last_error = state.last_error(&folder.id)?;
        rows.push(FolderView {
            folder: folder.clone(),
            stats,
            last_error,
            current: current_folder_id.as_deref() == Some(folder.id.as_str()),
            daemon_running: running,
        });
    }

    if json_output {
        let payload = rows
            .iter()
            .map(|row| {
                json!({
                    "path": row.folder.path,
                    "name": row.folder.name,
                    "directory": row.folder.directory,
                    "tags": row.folder.tags,
                    "enabled": row.folder.enabled,
                    "current": row.current,
                    "stats": {
                        "pending": row.stats.pending,
                        "uploading": row.stats.uploading,
                        "failed": row.stats.failed,
                        "done": row.stats.done,
                        "duplicate": row.stats.duplicate,
                    },
                    "lastError": row.last_error,
                })
            })
            .collect::<Vec<_>>();
        println!("{}", serde_json::to_string_pretty(&payload)?);
        return Ok(());
    }

    output::print_folder_list(&rows);
    Ok(())
}

async fn remove(path: Option<PathBuf>, purge: bool, yes: bool) -> Result<()> {
    let path = path.unwrap_or(std::env::current_dir()?);
    let canonical = canonical_dir(&path)?;
    let mut config = Config::load()?;
    let folder = config.find_folder(&canonical).cloned().with_context(|| {
        format!(
            "当前目录未加入同步: {}（先运行 afi add）",
            display_path(&canonical)
        )
    })?;

    if !yes {
        if !std::io::stdin().is_terminal() {
            bail!("非交互环境请加 -y 确认");
        }
        let confirmed = dialoguer::Confirm::new()
            .with_prompt(format!(
                "停止同步 {}？不会删除本地或云端照片",
                display_path(Path::new(&folder.path))
            ))
            .default(false)
            .interact()?;
        if !confirmed {
            println!("已取消。");
            return Ok(());
        }
    }

    config.remove_folder(&canonical)?;
    config.save()?;
    if purge {
        let state = State::open(&crate::config::state_path())?;
        state.remove_folder(&folder.id)?;
    }
    let _ = daemon::send_control("reload").await;
    output::print_removed(&folder);
    Ok(())
}

async fn set_enabled(path: Option<PathBuf>, enabled: bool) -> Result<()> {
    let path = path.unwrap_or(std::env::current_dir()?);
    let canonical = canonical_dir(&path)?;
    let mut config = Config::load()?;
    let folder = config
        .find_folder_mut(&canonical)
        .with_context(|| format!("当前目录未加入同步: {}", display_path(&canonical)))?;
    folder.enabled = enabled;
    let folder = folder.clone();
    config.save()?;
    let _ = daemon::send_control("reload").await;
    println!(
        "{} {}",
        if enabled {
            "已恢复同步"
        } else {
            "已暂停同步"
        },
        display_path(Path::new(&folder.path))
    );
    Ok(())
}

async fn retry(path: Option<PathBuf>) -> Result<()> {
    let state = State::open(&crate::config::state_path())?;
    let folder_id = match path {
        Some(path) => {
            let canonical = canonical_dir(&path)?;
            let config = Config::load()?;
            Some(
                config
                    .find_folder(&canonical)
                    .with_context(|| format!("当前目录未加入同步: {}", display_path(&canonical)))?
                    .id
                    .clone(),
            )
        }
        None => None,
    };
    let changed = state.reset_failed(folder_id.as_deref())?;
    let _ = daemon::send_control("reload").await;
    println!("已重新排队 {changed} 个失败文件。");
    Ok(())
}

async fn status(json_output: bool) -> Result<()> {
    let config = Config::load()?;
    let credentials = Credentials::load()?;
    let state = State::open(&crate::config::state_path())?;
    let stats = state.stats(None)?;
    let running = daemon::is_running().await;

    if json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "server": credentials.as_ref().map(|value| value.server_url.clone()),
                "loggedIn": credentials.is_some(),
                "daemonRunning": running,
                "folders": config.folders.len(),
                "enabledFolders": config.enabled_folders().count(),
                "stats": {
                    "pending": stats.pending,
                    "uploading": stats.uploading,
                    "failed": stats.failed,
                    "done": stats.done,
                    "duplicate": stats.duplicate,
                },
            }))?
        );
        return Ok(());
    }

    let view = StatusView {
        credentials,
        daemon_running: running,
        folders: config.folders.len(),
        enabled_folders: config.enabled_folders().count(),
        stats,
    };
    output::print_status(&view);
    Ok(())
}

async fn logout(revoke: bool) -> Result<()> {
    let Some(credentials) = Credentials::load()? else {
        println!("当前没有登录。");
        return Ok(());
    };

    let _ = daemon::send_control("shutdown").await;
    if revoke {
        let api = ApiClient::from_credentials(&credentials)?;
        match api.revoke_token(&credentials.token_id).await {
            Ok(()) => println!("已撤销远端令牌。"),
            Err(error) => eprintln!("{} 撤销远端令牌失败: {error}", style("警告:").yellow()),
        }
    }
    Credentials::delete()?;
    println!("已退出登录。");
    Ok(())
}

async fn doctor() -> Result<()> {
    println!("{}", style("Afilmory Sync 检查").bold());
    let mut failed = false;

    match Credentials::load()? {
        Some(credentials) => {
            println!("[ok] 登录: {}", credentials.server_url);
            if let Ok(expires) = DateTime::parse_from_rfc3339(&credentials.expires_at)
                && expires.with_timezone(&Utc) < Utc::now()
            {
                println!("[fail] 令牌已过期，运行 `afi login`");
                failed = true;
            }
            match ApiClient::from_credentials(&credentials)?
                .list_assets()
                .await
            {
                Ok(assets) => println!("[ok] 服务器可访问，远端 {} 张照片", assets.len()),
                Err(error) => {
                    println!("[fail] 服务器请求失败: {error}");
                    failed = true;
                }
            }
        }
        None => {
            println!("[fail] 未登录，运行 `afi login`");
            failed = true;
        }
    }

    let config = Config::load()?;
    println!("[ok] 配置文件: {}", crate::config::config_path().display());
    for folder in &config.folders {
        if Path::new(&folder.path).is_dir() {
            println!("[ok] 文件夹: {}", display_path(Path::new(&folder.path)));
        } else {
            println!("[fail] 文件夹不存在: {}", folder.path);
            failed = true;
        }
    }

    match State::open(&crate::config::state_path()) {
        Ok(_) => println!("[ok] 状态数据库: {}", crate::config::state_path().display()),
        Err(error) => {
            println!("[fail] 状态数据库: {error}");
            failed = true;
        }
    }

    println!(
        "[{}] 后台进程: {}",
        if daemon::is_running().await {
            "ok"
        } else {
            "warn"
        },
        if daemon::is_running().await {
            "运行中"
        } else {
            "未运行"
        }
    );

    if failed {
        bail!("检查发现需要处理的问题");
    }
    println!("{}", style("全部检查通过。").green().bold());
    Ok(())
}

async fn service(action: ServiceAction) -> Result<()> {
    match action {
        ServiceAction::Install => install_service(),
        ServiceAction::Uninstall => uninstall_service(),
    }
}

fn install_service() -> Result<()> {
    let executable = std::env::current_exe().context("无法定位 afi 可执行文件")?;
    let home = crate::config::afi_home();
    std::fs::create_dir_all(&home)?;

    #[cfg(target_os = "macos")]
    {
        let label = "cn.liuyaowen.afilmory-sync";
        let path = dirs_launch_agents()?.join(format!("{label}.plist"));
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array><string>{}</string><string>daemon</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{}/daemon.log</string>
  <key>StandardErrorPath</key><string>{}/daemon.log</string>
</dict>
</plist>
"#,
            xml_escape(&executable.to_string_lossy()),
            xml_escape(&home.to_string_lossy()),
            xml_escape(&home.to_string_lossy()),
        );
        std::fs::write(&path, plist)?;
        let _ = std::process::Command::new("launchctl")
            .args(["unload", "-w"])
            .arg(&path)
            .status();
        let status = std::process::Command::new("launchctl")
            .args(["load", "-w"])
            .arg(&path)
            .status()?;
        if !status.success() {
            bail!("launchctl 加载失败");
        }
        println!("已安装 launchd 服务: {}", path.display());
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let path = dirs_systemd_user()?.join("afilmory-sync.service");
        let unit = format!(
            "[Unit]\nDescription=Afilmory Sync\nAfter=network-online.target\n\n\
             [Service]\nExecStart={} daemon\nRestart=on-failure\nRestartSec=5\n\n\
             [Install]\nWantedBy=default.target\n",
            executable.display()
        );
        std::fs::write(&path, unit)?;
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "daemon-reload"])
            .status();
        let status = std::process::Command::new("systemctl")
            .args(["--user", "enable", "--now", "afilmory-sync.service"])
            .status()?;
        if !status.success() {
            bail!("systemctl 启用失败");
        }
        println!("已安装 systemd 用户服务: {}", path.display());
        return Ok(());
    }

    #[cfg(windows)]
    {
        let task = "AfilmorySync";
        let command = format!("\"{}\" daemon", executable.display());
        let status = std::process::Command::new("schtasks")
            .args([
                "/Create", "/F", "/SC", "ONLOGON", "/TN", task, "/TR", &command,
            ])
            .status()?;
        if !status.success() {
            bail!("schtasks 创建登录任务失败");
        }
        println!("已安装 Windows 登录任务: {task}");
        return Ok(());
    }

    #[allow(unreachable_code)]
    {
        bail!("当前系统不支持自动安装服务，请手动运行 `afi daemon`")
    }
}

fn uninstall_service() -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let label = "cn.liuyaowen.afilmory-sync";
        let path = dirs_launch_agents()?.join(format!("{label}.plist"));
        let _ = std::process::Command::new("launchctl")
            .args(["unload", "-w"])
            .arg(&path)
            .status();
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        println!("已卸载 launchd 服务。");
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let path = dirs_systemd_user()?.join("afilmory-sync.service");
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "disable", "--now", "afilmory-sync.service"])
            .status();
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        println!("已卸载 systemd 用户服务。");
        return Ok(());
    }

    #[cfg(windows)]
    {
        let task = "AfilmorySync";
        let status = std::process::Command::new("schtasks")
            .args(["/Delete", "/F", "/TN", task])
            .status()?;
        if !status.success() {
            bail!("删除 Windows 登录任务失败");
        }
        println!("已卸载 Windows 登录任务。");
        return Ok(());
    }

    #[allow(unreachable_code)]
    {
        bail!("当前系统不支持自动卸载服务")
    }
}

#[cfg(target_os = "macos")]
fn dirs_launch_agents() -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME 未设置")?;
    let path = PathBuf::from(home).join("Library/LaunchAgents");
    std::fs::create_dir_all(&path)?;
    Ok(path)
}

#[cfg(target_os = "linux")]
fn dirs_systemd_user() -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME 未设置")?;
    let path = PathBuf::from(home).join(".config/systemd/user");
    std::fs::create_dir_all(&path)?;
    Ok(path)
}

#[cfg(target_os = "macos")]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
