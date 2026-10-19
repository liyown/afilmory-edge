# Afilmory Sync

把本地文件夹里的照片自动上传到 Afilmory Edge。命令名是 `afi`。

## 安装

一键安装（自动选择 macOS/Linux 的预编译包；没有对应包时会回退到源码构建）：

```bash
curl -fsSL https://raw.githubusercontent.com/liyown/afilmory-edge/main/scripts/install-afi.sh | sh
```

Windows（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/liyown/afilmory-edge/main/scripts/install-afi.ps1 | iex
```

默认安装到 `~/.local/bin/afi`，可以用 `AFI_INSTALL_DIR` 改目录：

```bash
curl -fsSL https://raw.githubusercontent.com/liyown/afilmory-edge/main/scripts/install-afi.sh \
  | AFI_INSTALL_DIR="$HOME/bin" sh
```

强制从源码安装：

```bash
curl -fsSL https://raw.githubusercontent.com/liyown/afilmory-edge/main/scripts/install-afi.sh \
  | AFI_FROM_SOURCE=1 sh
```

如果已经在仓库里，也可以直接运行 `sh scripts/install-afi.sh` 或手动构建：

```bash
cargo install --path apps/sync --locked
```

需要 Rust 1.98+。预编译包由 GitHub Release（`afi-v*` tag）生成，支持
macOS arm64/x86_64 和 Linux arm64/x86_64。

## 登录

```bash
afi login
```

默认使用内置地址 `https://photos.liuyaowen.cn`。如果部署在别的域名：

```bash
afi login -s https://photos.example.com
```

会打开浏览器。用 Google OAuth 或邮箱密码登录，确认授权后，CLI 只在
`~/.afi/credentials.json` 保存一个长期令牌（权限 0600），不保存密码。

没有桌面环境时：

```bash
afi login -N
```

只打印授权链接，在另一台设备打开即可，CLI 会等待本地回调。

## 同步一个文件夹

```bash
cd ~/Pictures/import
afi add
```

`add` 默认使用当前目录，并自动启动后台进程。之后新增或修改的文件会被监听并上传。

常用参数：

```bash
afi add ~/Pictures/import -d import -t camera,daily -n "日常导入"
```

- `-d/--directory`：相册里的目录名，默认使用文件夹名。
- `-t/--tags`：标签，逗号分隔。
- `-n/--name`：列表里显示的名称。

## 查看和管理

```bash
afi ls            # 已同步的文件夹、状态、上传统计
afi st            # 登录状态、后台进程、队列统计
afi rm            # 停止同步当前文件夹（不会删除照片）
afi rm -p         # 同时清理本地队列状态
afi pause         # 暂停当前文件夹
afi resume        # 恢复当前文件夹
afi retry         # 重新上传失败的文件
afi logout -R     # 退出登录并撤销远端令牌
```

`afi rm` 会二次确认；`-y` 可跳过确认。`-j` 可以让 `ls`/`st` 输出 JSON。

## 常驻运行

`afi add` 会启动一个后台进程。要让它登录后自动运行：

```bash
afi service install
```

macOS 使用 launchd，Linux 使用 systemd 用户服务。卸载：

```bash
afi service uninstall
```

## 工作方式

- 使用 macOS FSEvents / Linux inotify **监听文件变动**，没有定时轮询。
- 启动、`add`、`resume` 时会做一次全量核对，补上离线期间新增的文件。
- 文件稳定后计算 SHA-256，并用内容生成固定的 `photoId`，重试不会重复上传。
- 同一内容在远端已存在时直接跳过；如果配置了标签，会补写标签。
- Live Photo 按同名 `.HEIC/.JPG` + `.MOV` 配对；没有配对图片的 `.MOV` 跳过。
- 缩略图、ThumbHash、色调分析在本地生成；HEIC 使用纯 Rust 解码。
- RAW/DNG 首版不保证缩略图，原图仍会上传。

## 限制

- 网络挂载或某些网盘目录可能不产生文件系统事件；本工具不会退化成轮询。
- 服务端单文件上限 1 GiB。
- 上传权限等同于站点 owner：令牌可以上传、修改和删除照片，请妥善保管。
- Windows 使用 x64 预编译包；ARM64 Windows 会以 x64 模拟方式运行。
- Windows 的本地控制通道使用 loopback，不使用 Unix socket。

## 发布预编译包

推送 `afi-v*` tag 会触发 GitHub Actions 构建 macOS/Linux 的 arm64/x86_64 压缩包，
并附上 SHA-256 校验文件：

```bash
git tag afi-v0.1.0
git push origin afi-v0.1.0
```

安装脚本会自动下载最新 Release 中对应平台的 `afi-<os>-<arch>.tar.gz`。

## 状态目录

默认 `~/.afi/`，可用 `AFI_HOME` 覆盖：

```
config.toml        # 服务器地址和文件夹列表
credentials.json   # 令牌（0600）
state.sqlite       # 文件/上传队列
control.json       # 后台进程控制信息（本机 loopback）
daemon.log         # 后台日志
```
