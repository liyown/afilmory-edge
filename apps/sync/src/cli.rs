use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
    name = "afi",
    version,
    about = "Afilmory Sync：把文件夹里的照片自动上传到 Afilmory Edge",
    long_about = "在要同步的文件夹里运行 `afi add`，之后新增的照片会自动上传。\n\
                  运行 `afi ls` 查看文件夹，`afi rm` 停止同步当前文件夹。"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// 把文件夹加入同步（默认当前目录）
    #[command(alias = "a")]
    Add {
        /// 文件夹路径，默认当前目录
        path: Option<PathBuf>,
        /// 相册目录名，默认使用文件夹名
        #[arg(short = 'd', long)]
        directory: Option<String>,
        /// 标签，逗号分隔
        #[arg(short = 't', long, value_delimiter = ',')]
        tags: Vec<String>,
        /// 显示名称
        #[arg(short = 'n', long)]
        name: Option<String>,
        /// 只加入列表，不启动后台进程
        #[arg(long)]
        no_start: bool,
    },

    /// 查看已同步的文件夹
    #[command(alias = "l", alias = "list")]
    Ls {
        /// 输出 JSON
        #[arg(short = 'j', long)]
        json: bool,
    },

    /// 停止同步文件夹（默认当前目录）
    #[command(alias = "r", alias = "remove")]
    Rm {
        /// 文件夹路径，默认当前目录
        path: Option<PathBuf>,
        /// 同时清理本地队列状态（不会删除照片）
        #[arg(short = 'p', long)]
        purge: bool,
        /// 不询问确认
        #[arg(short = 'y', long)]
        yes: bool,
    },

    /// 查看后台进程和上传队列
    #[command(alias = "status")]
    St {
        /// 输出 JSON
        #[arg(short = 'j', long)]
        json: bool,
    },

    /// 暂停同步文件夹
    Pause {
        /// 文件夹路径，默认当前目录
        path: Option<PathBuf>,
    },

    /// 恢复同步文件夹
    Resume {
        /// 文件夹路径，默认当前目录
        path: Option<PathBuf>,
    },

    /// 重试失败的文件
    Retry {
        /// 只重试这个文件夹，默认全部
        path: Option<PathBuf>,
    },

    /// 浏览器授权登录
    #[command(alias = "in")]
    Login {
        /// 服务器地址，例如 https://photos.example.com
        #[arg(short = 's', long)]
        server: Option<String>,
        /// 不自动打开浏览器，只打印链接
        #[arg(short = 'N', long)]
        no_browser: bool,
    },

    /// 退出登录
    #[command(alias = "out")]
    Logout {
        /// 同时撤销远端令牌
        #[arg(short = 'R', long)]
        revoke: bool,
    },

    /// 前台运行后台进程（给 launchd/systemd 用）
    #[command(hide = true)]
    Daemon,

    /// 安装/卸载常驻服务
    Service {
        #[command(subcommand)]
        action: ServiceAction,
    },

    /// 检查登录、配置、目录和后台进程
    Doctor,
}

#[derive(Debug, Subcommand)]
pub enum ServiceAction {
    /// 安装为 launchd/systemd 用户服务
    Install,
    /// 卸载服务
    Uninstall,
}
