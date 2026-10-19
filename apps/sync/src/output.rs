use console::style;

use crate::config::{FolderConfig, display_path};
use crate::credentials::Credentials;
use crate::state::Stats;

pub struct FolderView {
    pub folder: FolderConfig,
    pub stats: Stats,
    pub last_error: Option<String>,
    pub current: bool,
    pub daemon_running: bool,
}

pub struct StatusView {
    pub credentials: Option<Credentials>,
    pub daemon_running: bool,
    pub folders: usize,
    pub enabled_folders: usize,
    pub stats: Stats,
}

pub fn print_folder_list(rows: &[FolderView]) {
    if rows.is_empty() {
        println!("还没有同步任何文件夹。");
        println!("进入要同步的文件夹，运行：");
        println!("  {}", style("afi add").bold());
        return;
    }

    for (index, row) in rows.iter().enumerate() {
        if index > 0 {
            println!();
        }
        let marker = if row.current {
            style("*").cyan().bold().to_string()
        } else {
            " ".to_string()
        };
        let status = if !row.folder.enabled {
            style("已暂停").yellow().to_string()
        } else if row.daemon_running {
            style("监听中").green().to_string()
        } else {
            style("等待后台").yellow().to_string()
        };
        println!(
            "{marker} {}  {status}",
            style(display_path(std::path::Path::new(&row.folder.path))).bold()
        );
        println!("  相册目录: {}", row.folder.directory);
        if !row.folder.tags.is_empty() {
            println!("  标签: {}", row.folder.tags.join(", "));
        }
        println!(
            "  已上传 {} · 待处理 {} · 失败 {} · 重复 {}",
            row.stats.done, row.stats.pending, row.stats.failed, row.stats.duplicate
        );
        if let Some(error) = &row.last_error {
            println!("  {}", style(format!("最近错误: {error}")).red());
        }
    }
    println!();
    println!(
        "共 {} 个文件夹；{} 查看状态，{} 停止同步当前文件夹。",
        rows.len(),
        style("afi st").bold(),
        style("afi rm").bold()
    );
}

pub fn print_status(view: &StatusView) {
    match &view.credentials {
        Some(credentials) => {
            println!(
                "登录: {}  {}",
                credentials.server_url,
                style(&credentials.prefix).dim()
            );
        }
        None => {
            println!("登录: {}", style("未登录，运行 `afi login`").yellow());
        }
    }
    println!(
        "后台: {}",
        if view.daemon_running {
            style("运行中").green().to_string()
        } else {
            style("未运行").yellow().to_string()
        }
    );
    println!(
        "文件夹: {} 个（{} 个监听中）",
        view.folders, view.enabled_folders
    );
    println!(
        "队列: 待处理 {} · 上传中 {} · 失败 {} · 已完成 {} · 重复 {}",
        view.stats.pending,
        view.stats.uploading,
        view.stats.failed,
        view.stats.done,
        view.stats.duplicate
    );
    if !view.daemon_running && view.enabled_folders > 0 {
        println!("运行 {} 启动后台监听。", style("afi add").bold());
    }
}

pub fn print_added(folder: &FolderConfig) {
    println!("{}", style("已加入同步").green().bold());
    println!(
        "  文件夹: {}",
        display_path(std::path::Path::new(&folder.path))
    );
    println!("  相册目录: {}", folder.directory);
    if !folder.tags.is_empty() {
        println!("  标签: {}", folder.tags.join(", "));
    }
    println!("之后新增或修改的照片会自动上传。");
}

pub fn print_removed(folder: &FolderConfig) {
    println!("{}", style("已停止同步").green().bold());
    println!(
        "  文件夹: {}",
        display_path(std::path::Path::new(&folder.path))
    );
    println!("本地和云端照片都没有删除。");
}
