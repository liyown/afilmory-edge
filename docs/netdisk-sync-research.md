# 网盘照片自动同步调研

日期：2026-10-19

结论先行：**没有一种通用的「网盘 → 画廊」同步协议**。可行路径只有三类，按接入成本从低到高：

1. 官方桌面/NAS 同步客户端把网盘同步到本地目录，`afi` 继续用文件夹模式。
2. 用 rclone / WebDAV 把网盘挂载或同步到本地，再交给 `afi`。
3. 直接接网盘官方 API + Webhook。

## 对比

| 方案 | 覆盖范围 | 实时性 | 本机/NAS 可行性 | 维护成本 |
| --- | --- | --- | --- | --- |
| 同步客户端目录 | 服务商支持桌面客户端的网盘 | 客户端决定，通常几秒到几分钟 | 高 | 低 |
| rclone / WebDAV | rclone 官方支持的网盘、任意 WebDAV | 轮询或挂载 | 中高 | 中 |
| 官方 API + Webhook | 单个服务商 | 近实时 | 需要公网回调和 OAuth | 高 |

## 路径一：同步客户端目录

这是最稳的做法，也是 `afi` 首版已经覆盖的方式：

- 安装网盘官方客户端（Dropbox、Google Drive、OneDrive、百度网盘、阿里云盘、坚果云等）。
- 把要同步的相册目录设置为本地同步目录。
- 在本地同步目录里运行 `afi add`。

优点：不依赖第三方 API，不处理 OAuth，不需要公网回调；网盘客户端负责下载和冲突处理。

限制：

- 客户端必须常驻。
- 部分国内网盘没有 Linux/NAS 官方客户端，NAS 上只能用厂商套件或第三方方案。
- 如果客户端只提供「按需文件」而文件内容不在本地，`afi` 无法读取。

## 路径二：rclone / WebDAV

rclone 官方支持 WebDAV、Dropbox、Google Drive、OneDrive、Box、pCloud、S3、SFTP、SMB 等后端
（见 [rclone overview](https://rclone.org/overview/)）。可以：

- `rclone mount` 成一个本地目录，再让 `afi` 监听；
- 或定期 `rclone sync` 到本地目录，再让 `afi` 处理本地文件。

注意：

- rclone **不官方支持阿里云盘、百度网盘、115**。国内网盘通常依赖第三方 WebDAV、AList/OpenList
  或非官方 rclone 分支；这些方案的授权和限速策略会变，出现过第三方授权被收紧的情况。
- 挂载目录不一定产生文件系统事件。`afi` 按设计要求不轮询；如果挂载层不产生事件，就需要
  先用 `rclone sync` 落到本地磁盘，或者后续单独实现 WebDAV 轮询源。
- WebDAV 是兼容性最好的「直连」协议：坚果云、部分 NAS 和网盘都提供。后续如果要脱离桌面客户端，
  建议先加 WebDAV 轮询源，而不是直接绑某一家国内网盘 API。

## 路径三：官方 API + Webhook

三家主流海外网盘的机制：

- **Dropbox**：在 App Console 注册 webhook，验证 `challenge`，之后收到变更通知；通知不含文件详情，
  需要用保存的 cursor 调 `/files/list_folder/continue` 获取变化。见
  [Dropbox webhooks](https://docs.dropboxapi.com/dropbox-api/docs/webhooks)。
- **Google Drive**：用 `changes.watch` 或 `files.watch` 创建推送通道；回调必须是公网 HTTPS，
  通道最长 1 周（`changes`）或 1 天（`files`），通知体为空，需要再调 `changes.list` / `files.get`。
  见 [Google Drive push notifications](https://developers.google.com/workspace/drive/api/guides/push)。
- **OneDrive / Microsoft Graph**：订阅 `driveItem` 变更，webhook 最长约 30 天，需要续订；
  也可以用 delta query 拉取变化。见
  [Microsoft Graph change notifications](https://learn.microsoft.com/en-us/graph/change-notifications-overview)。

共同成本：

- 需要注册 OAuth 应用、保存 refresh token、处理续订和失败重试。
- 需要公网 HTTPS 回调地址；Cloudflare Worker 可以做回调入口，但下载大文件仍要经过 Worker 或
  由本地进程完成。
- Webhook 只告诉「有变化」，真正列出/下载文件还要再调 API。

对个人画廊来说，这条路径的复杂度明显高于「同步客户端目录 + 文件夹监听」。

## 国内网盘

- 百度网盘开放平台需要开发者/应用审核，并按应用类型分配权限和配额；个人应用能拿到的能力有限。
  参考：[权限与配额](https://pan.baidu.com/union/doc/%E4%BD%BF%E7%94%A8%E5%85%A5%E9%97%A8/%E6%9D%83%E9%99%90%E4%B8%8E%E9%85%8D%E9%A2%9D/)。
- 阿里云盘开放平台同样有开发者协议、审核和限流；第三方播放器/WebDAV 还涉及额外的「第三方权益」
  和限速策略。
- AList/OpenList 等第三方聚合工具曾出现阿里云盘、115 授权被收紧的情况，不适合作为长期核心依赖。

因此，国内网盘的推荐顺序是：

1. 官方桌面/NAS 同步客户端 → 本地目录 → `afi`。
2. 网盘提供 WebDAV 时，用 WebDAV 源。
3. 最后才考虑官方 API。

## 建议

- **首版保持文件夹模式**：它已经覆盖「同步客户端目录」和「rclone sync 到本地」两种最常见用法。
- 如果以后要脱离桌面客户端，先实现 **WebDAV 轮询源**：协议通用、无需 OAuth、兼容坚果云和多数 NAS。
- 官方 API 适配按实际使用的单一网盘再做，不要一开始就抽象成「通用网盘层」。
- 网盘只作为照片**来源**；画廊存储仍然是 OSS/R2，不把网盘当图床。
