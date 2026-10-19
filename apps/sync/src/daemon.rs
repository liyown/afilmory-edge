use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use fs2::FileExt;
use notify::event::EventKind;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, mpsc};
use tracing::{info, warn};

use crate::api::ApiClient;
use crate::config::{
    Config, FolderConfig, control_path, ensure_home, lock_path, pid_path, state_path, write_private,
};
use crate::credentials::Credentials;
use crate::inspect::is_supported;
use crate::scanner::{is_ignored, scan_folder};
use crate::state::State;
use crate::sync::{SyncEngine, run_job};

#[derive(Debug)]
struct Job {
    folder: FolderConfig,
    path: PathBuf,
    inflight: Option<Arc<Mutex<HashSet<PathBuf>>>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ControlInfo {
    port: u16,
    token: String,
}

#[derive(Debug)]
enum ControlCommand {
    Reload,
    Retry,
    Shutdown,
    Ping,
}

pub async fn run() -> Result<()> {
    ensure_home()?;
    let credentials = Credentials::require()?;
    let api = ApiClient::from_credentials(&credentials)?;
    let state = Arc::new(State::open(&state_path())?);
    state.recover_expired_leases()?;

    let guard = DaemonGuard::acquire()?;
    let mut config = Config::load()?;
    let engine = Arc::new(SyncEngine::new(
        api,
        Arc::clone(&state),
        config.stable_wait_ms,
    )?);
    if let Err(error) = engine.refresh_remote_cache().await {
        warn!(%error, "读取远端照片列表失败，稍后上传时再检查");
    }

    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<PathBuf>();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            if let Ok(event) = result {
                if matches!(event.kind, EventKind::Access(_)) {
                    return;
                }
                for path in event.paths {
                    let _ = event_tx.send(path);
                }
            }
        },
        notify::Config::default(),
    )
    .context("启动文件监听失败")?;

    let mut watched = sync_watches(&mut watcher, &config, &HashSet::new())?;

    let (job_tx, job_rx) = mpsc::channel::<Job>(1024);
    spawn_workers(
        Arc::clone(&engine),
        Arc::new(Mutex::new(job_rx)),
        config.concurrency.max(1),
    );
    let inflight = Arc::new(Mutex::new(HashSet::<PathBuf>::new()));
    enqueue_initial_scan(&config, &job_tx);

    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<ControlCommand>();
    spawn_control_server(control_tx).await?;

    info!(
        folders = config.enabled_folders().count(),
        "Afilmory Sync 已启动，正在监听文件变动"
    );

    let mut term = termination_signal();
    loop {
        tokio::select! {
            Some(path) = event_rx.recv() => {
                handle_event(&config, path, &job_tx, &inflight).await;
            }
            Some(command) = control_rx.recv() => {
                match command {
                    ControlCommand::Reload => {
                        config = Config::load()?;
                        engine.set_stable_wait_ms(config.stable_wait_ms);
                        let previous = watched.clone();
                        watched = sync_watches(&mut watcher, &config, &watched)?;
                        let added = watched.difference(&previous).cloned().collect::<Vec<_>>();
                        for folder in config.enabled_folders() {
                            if added.iter().any(|path| Path::new(&folder.path) == path.as_path()) {
                                enqueue_folder(folder, &job_tx);
                            }
                        }
                        info!(folders = config.enabled_folders().count(), "配置已重新加载");
                    }
                    ControlCommand::Retry => {
                        enqueue_initial_scan(&config, &job_tx);
                        info!("已重新扫描失败文件");
                    }
                    ControlCommand::Shutdown => break,
                    ControlCommand::Ping => {}
                }
            }
            _ = term.recv() => break,
        }
    }

    info!("Afilmory Sync 已停止");
    drop(job_tx);
    drop(guard);
    Ok(())
}

fn spawn_workers(
    engine: Arc<SyncEngine>,
    receiver: Arc<Mutex<mpsc::Receiver<Job>>>,
    concurrency: usize,
) {
    for _ in 0..concurrency {
        let engine = Arc::clone(&engine);
        let receiver = Arc::clone(&receiver);
        tokio::spawn(async move {
            loop {
                let job = {
                    let mut guard = receiver.lock().await;
                    guard.recv().await
                };
                match job {
                    Some(job) => {
                        let inflight = job.inflight.clone();
                        let path = job.path.clone();
                        run_job(Arc::clone(&engine), job.folder, job.path).await;
                        if let Some(inflight) = inflight {
                            inflight.lock().await.remove(&path);
                        }
                    }
                    None => break,
                }
            }
        });
    }
}

fn sync_watches(
    watcher: &mut RecommendedWatcher,
    config: &Config,
    previous: &HashSet<PathBuf>,
) -> Result<HashSet<PathBuf>> {
    let next: HashSet<PathBuf> = config
        .enabled_folders()
        .map(|folder| PathBuf::from(&folder.path))
        .collect();
    for path in previous.difference(&next) {
        let _ = watcher.unwatch(path);
    }
    for path in next.difference(previous) {
        if let Err(error) = watcher.watch(path, RecursiveMode::Recursive) {
            warn!(folder = %path.display(), %error, "监听文件夹失败，跳过");
        }
    }
    Ok(next)
}

fn enqueue_initial_scan(config: &Config, job_tx: &mpsc::Sender<Job>) {
    for folder in config.enabled_folders() {
        enqueue_folder(folder, job_tx);
    }
}

fn enqueue_folder(folder: &FolderConfig, job_tx: &mpsc::Sender<Job>) {
    let folder = folder.clone();
    let job_tx = job_tx.clone();
    tokio::task::spawn_blocking(move || match scan_folder(&folder) {
        Ok(files) => {
            for path in files {
                let _ = job_tx.blocking_send(Job {
                    folder: folder.clone(),
                    path,
                    inflight: None,
                });
            }
        }
        Err(error) => warn!(folder = %folder.path, %error, "扫描文件夹失败"),
    });
}

async fn handle_event(
    config: &Config,
    path: PathBuf,
    job_tx: &mpsc::Sender<Job>,
    inflight: &Arc<Mutex<HashSet<PathBuf>>>,
) {
    if is_ignored(&path) || !is_supported(&path) {
        return;
    }
    let canonical = match tokio::fs::canonicalize(&path).await {
        Ok(path) => path,
        Err(_) => return,
    };
    let Some(folder) = find_folder(config, &canonical) else {
        return;
    };

    {
        let mut guard = inflight.lock().await;
        if !guard.insert(canonical.clone()) {
            return;
        }
    }

    if job_tx
        .send(Job {
            folder,
            path: canonical.clone(),
            inflight: Some(Arc::clone(inflight)),
        })
        .await
        .is_err()
    {
        inflight.lock().await.remove(&canonical);
    }
}

fn find_folder(config: &Config, path: &Path) -> Option<FolderConfig> {
    config
        .enabled_folders()
        .filter(|folder| path.starts_with(Path::new(&folder.path)))
        .max_by_key(|folder| folder.path.len())
        .cloned()
}

async fn spawn_control_server(sender: mpsc::UnboundedSender<ControlCommand>) -> Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .context("启动本地控制通道失败")?;
    let port = listener.local_addr()?.port();
    let token = hex::encode(rand::random::<[u8; 16]>());
    let info = ControlInfo {
        port,
        token: token.clone(),
    };
    let raw = serde_json::to_vec(&info).context("序列化控制信息失败")?;
    write_private(&control_path(), &raw)?;

    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                continue;
            };
            let sender = sender.clone();
            let token = token.clone();
            tokio::spawn(async move {
                handle_control_connection(stream, sender, token).await;
            });
        }
    });
    Ok(())
}

async fn handle_control_connection(
    stream: TcpStream,
    sender: mpsc::UnboundedSender<ControlCommand>,
    expected_token: String,
) {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    if reader.read_line(&mut line).await.is_err() {
        return;
    }
    let trimmed = line.trim();
    let (provided_token, command_name) = trimmed.split_once(' ').unwrap_or(("", trimmed));

    let command = if provided_token != expected_token {
        None
    } else {
        match command_name {
            "reload" => Some(ControlCommand::Reload),
            "retry" => Some(ControlCommand::Retry),
            "shutdown" => Some(ControlCommand::Shutdown),
            "ping" => Some(ControlCommand::Ping),
            _ => None,
        }
    };

    let response = match command {
        Some(command) => {
            let _ = sender.send(command);
            "ok\n"
        }
        None if provided_token != expected_token => "unauthorized\n",
        None => "unknown\n",
    };
    let mut stream = reader.into_inner();
    let _ = stream.write_all(response.as_bytes()).await;
}

pub async fn send_control(command: &str) -> Result<String> {
    let path = control_path();
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("后台进程未运行（{}）", path.display()))?;
    let info: ControlInfo = serde_json::from_str(&raw).context("控制信息损坏，重启后台进程")?;
    let mut stream = TcpStream::connect(("127.0.0.1", info.port))
        .await
        .context("后台进程未运行")?;
    stream
        .write_all(format!("{} {command}\n", info.token).as_bytes())
        .await?;
    let mut reader = BufReader::new(stream);
    let mut response = String::new();
    reader.read_line(&mut response).await?;
    Ok(response.trim().to_string())
}

pub async fn is_running() -> bool {
    if !control_path().exists() {
        return false;
    }
    send_control("ping").await.is_ok()
}

pub async fn start_detached() -> Result<()> {
    if is_running().await {
        return Ok(());
    }
    ensure_home()?;
    let log = afi_home_log();
    let output = OpenOptions::new().create(true).append(true).open(&log)?;
    let stderr = output.try_clone()?;
    let executable = std::env::current_exe().context("无法定位 afi 可执行文件")?;
    let mut command = Command::new(executable);
    command
        .arg("daemon")
        .stdin(Stdio::null())
        .stdout(Stdio::from(output))
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    command.spawn().context("启动后台进程失败")?;

    for _ in 0..50 {
        if is_running().await {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    bail!("后台进程启动超时，请查看 {}", log.display())
}

fn afi_home_log() -> PathBuf {
    crate::config::afi_home().join("daemon.log")
}

struct DaemonGuard {
    _lock: std::fs::File,
    pid_path: PathBuf,
    control_path: PathBuf,
}

impl DaemonGuard {
    fn acquire() -> Result<Self> {
        ensure_home()?;
        let lock = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(lock_path())?;
        if lock.try_lock_exclusive().is_err() {
            bail!("后台进程已经在运行");
        }
        let pid_path = pid_path();
        let control_path = control_path();
        fs::write(&pid_path, std::process::id().to_string())?;
        Ok(Self {
            _lock: lock,
            pid_path,
            control_path,
        })
    }
}

impl Drop for DaemonGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.pid_path);
        let _ = fs::remove_file(&self.control_path);
    }
}

fn termination_signal() -> tokio::sync::mpsc::Receiver<()> {
    let (sender, receiver) = tokio::sync::mpsc::channel(1);
    tokio::spawn(async move {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{SignalKind, signal};
            let mut terminate = signal(SignalKind::terminate()).ok();
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = async {
                    if let Some(signal) = terminate.as_mut() {
                        signal.recv().await;
                    }
                } => {}
            }
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }
        let _ = sender.send(()).await;
    });
    receiver
}
