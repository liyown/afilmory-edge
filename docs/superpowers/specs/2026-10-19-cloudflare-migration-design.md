# Cloudflare 迁移可行性调研与目标技术栈

Status: **research / proposal**（未实施）
Date: 2026-10-19
Scope: 整个 monorepo 能否、以及以什么形态跑在 Cloudflare 上。

---

## 0. TL;DR

**前提需要修正一半。** Next.js 16 可以部署到 Cloudflare——官方路线是 `@opennextjs/cloudflare`，当前 `1.20.12` 的 peer 依赖是 `next: >=15.5.28 <16 || >=16.4.1`，仓库锁的是 `16.4.0`，升到 `16.4.2`（当前 latest）即可。所以「Next 无法上 CF」不成立。

**但「能不能」不等于「该不该」。** `apps/ssr` 只有 21 个源文件，没有任何 ISR / SSG / `generateStaticParams` / middleware，全部逻辑是「读 Vite 打出来的 `index.html` → 用 linkedom 改 meta → 返回」，加一个把 `/og/:id` 反代给 core 的路由。为这 300 行需求去养一个 RSC 运行时（OpenNext 会打包整个 Next standalone server）是负债，不是资产。

**真正的迁移难点在 `be/apps/core`，不在 Next。** 它在同一个进程里同时依赖：

- `sharp` + `exiftool-vendored`（原生二进制 / 子进程）——上传时直接跑完整 builder 管线
- `@resvg/resvg-js`（N-API 原生模块）——OG 图渲染
- `pg-native`（libpq）
- `ioredis`（TCP）
- `node:fs`（静态站点 + 字体）
- 模块级单例 `pg.Pool` / DI 容器 / env

这些在 Workers（128 MB 内存、无文件系统、无原生模块）里一个都跑不了。

**推荐方案：边缘 Worker 单体 + 外部 Postgres；媒体处理优先不用容器（§5.7 路线 A），确有保真度需求再上 Containers。**

| 层 | 目标 |
| --- | --- |
| SPA | Workers Static Assets（静态请求免费、无限） |
| SSR shell / SEO / OG | 同一个 Worker 内的 Hono 路由，用 `HTMLRewriter` 注入，OG 用 satori + `resvg-wasm` |
| API | `be/apps/core` 的 Hono 应用直接编译进 Worker（保留 DI / 装饰器 / ALS） |
| DB | 保留 PostgreSQL，走 Hyperdrive + 每请求 `pg.Client`（官方推荐驱动组合） |
| 缓存 / 锁 | KV + Durable Objects（现有 Redis 用量极薄，可整体去掉） |
| 队列 | Cloudflare Queues（替代 `xadd`/`xreadgroup`） |
| 图片处理 | 优先「不算图」：R2 原图 + Cloudflare Images 变换 + Worker 内 `exifr` 读 EXIF；保真度不够时再上 Cloudflare Containers（§5.7） |
| 存储 | **不强制 R2**：保留多 provider（S3/B2/OSS/COS/GitHub/local，平台托管或租户自带），R2 只是默认推荐（§5.13） |
| 租户域名 | Cloudflare for SaaS custom hostname → Worker as origin（已经是现状） |

**工期估计：1 人 7–10 周**，其中 4–6 周是 core 端口；如果只想「先上 CF」，Phase 0–1 两周内可见效果。
**最小改动方案（Containers 直接跑现有 Dockerfile）1–2 周可落地**，但冷启动 1–3 s、没有内置自动扩缩、长期性价比一般——适合过渡，不适合终态。

---

## 1. 前提核查：Next.js 在 Cloudflare 上的三条路

| 路径 | 现状 | 对本仓库是否适用 |
| --- | --- | --- |
| 静态导出（`output: 'export'`） | Next 官方支持 | ❌ 会丢掉 SSR 注入能力，而注入正是本项目的核心需求 |
| `@cloudflare/next-on-pages`（Pages） | 已进入维护/弃用状态，Cloudflare 官方推荐迁移到 OpenNext | ❌ 不要新起 |
| `@opennextjs/cloudflare`（Workers） | 活跃维护，`1.20.12`（2026-10-15 发布），Next 16 已支持 | ✅ 技术上可行，需先把 `next` 升到 ≥ 16.4.1 |

关键版本事实：

```
@opennextjs/cloudflare@1.20.12
  peerDependencies:
    next: ">=15.5.28 <16 || >=16.4.1"
    wrangler: "^4.148.0"
repo: next 16.4.0  → 低于下界，需升级
npm latest next: 16.4.2
```

即便升级后能跑，也要评估：OpenNext 的产物是一个完整的 Next server bundle（含 RSC runtime、路由表），对这个只有 21 个文件、零 ISR 的宿主来说是纯开销；而且中间多一层适配器就多一层需要跟随 Next 升级的兼容面。

**结论：OpenNext 是「保底选项」，不是推荐选项。**

---

## 2. 代码事实盘点

### 2.1 天生适配 Cloudflare 的部分（这是好消息）

| 事实 | 证据 | 迁移含义 |
| --- | --- | --- |
| 后端就是 Hono | `be/apps/core/src/index.ts` 用 `@hono/node-server` 的 `serve({ fetch: hono.fetch })` | 换入口即可，路由/中间件零改动 |
| DI 是 tsyringe，纯 JS | `@injectable()` / `reflect-metadata` | workerd 可运行；风险在构建链（见 §7） |
| 请求上下文用 AsyncLocalStorage | `HttpContext` / `be/apps/core/src/context` | Workers 有官方 `AsyncLocalStorage` 实现（仅缺 `enterWith`/`disable`） |
| DB 已经是 `drizzle-orm/node-postgres` + `pg.Pool` | `database.provider.ts:83` | 正是 Hyperdrive 官方推荐组合（Hyperdrive 明确不支持 Drizzle + postgres.js） |
| Redis 用量极薄 | 全仓只有 2 处注入；实际调用仅 `xadd` / `xreadgroup` / `get` | 可以整体删掉 Redis 概念，不需要"托管 Redis" |
| 存储是 S3 协议 | `packages/builder/src/storage/providers`、core 的 `@aws-sdk/client-s3` | R2 兼容 S3 API，builder 侧几乎零改动 |
| 多租户自定义域名已在 Cloudflare 上 | `cloudflare-custom-hostname.service.ts`（Cloudflare for SaaS API） | 迁移后同一个 zone 直接接 Worker origin |
| SPA 是纯静态产物 | `apps/web` Vite build | Workers Assets 直接托管 |

### 2.2 硬阻塞（必须在 Worker 之外，或在 Worker 内替换）

| 依赖 | 位置 | 为什么不行 | 替代 |
| --- | --- | --- | --- |
| `sharp` | `packages/builder`，被 `photo-builder.service.ts` 在上传路径直接调用 | native addon，Workers 无 | Containers |
| `exiftool-vendored` | 同上（README 里还要装 `perl` + `exiftool` 二进制） | 子进程 + 二进制 | Containers |
| `@resvg/resvg-js` | `packages/renderer/src/og/og.renderer.tsx`、`og.service.ts` | N-API native | `@resvg/resvg-wasm` / `workers-og` |
| `pg-native` | `be/apps/core`、`be/packages/db` 的直接依赖 | libpq | 删除（Hyperdrive 链路走纯 JS `pg`） |
| `ioredis` | `be/packages/redis`、`task-queue` 的 redis driver | `node:net` TCP | Queues + KV + DO |
| `busboy` | `photo-upload.parser.ts` | 依赖 Node stream 的多部分解析 | R2 直传 + 预签名 / Workers `request.formData()` |
| `node:fs` | `static-asset.service.ts`、`og.service.ts` 读字体 | Workers 无文件系统 | Assets binding / R2 |
| `@hono/node-server` | `src/index.ts` | Node 专用 serve | `export default { fetch: app.fetch }` |
| `setInterval` | `cleanup-sweep.scheduler.ts`、`account-deletion.queue.ts`、`sse.ts` | 实例随时被回收 | Cron Trigger / DO alarm / 流内循环 |
| 模块级单例 `pg.Pool` | `PgPoolProvider` | Workers 禁止 I/O 跨请求复用 | 每请求 `pg.Client`（Hyperdrive 负责真正的池化） |

### 2.3 规模数据（用于估算工作量）

| 指标 | 值 |
| --- | --- |
| `be/apps/core/src` 文件数 | 343 |
| 数据表 / 迁移 | 37 张表 / 30 个迁移，16 处 `jsonb` |
| `apps/ssr/src` 文件数 | 21（其中路由 8 个） |
| `apps/web` 依赖数 | 62 |
| 全仓 TS/TSX | ~18.6 万行 |

37 张表、`jsonb`、`timestamp`、以及依赖 PG 的租户隔离（`set_config('afilmory.tenant_id', ...)`）意味着：**换 D1 等于重写数据层**，保留 Postgres 是唯一理性选择。

---

## 3. 候选方案对比

| 维度 | A. 全量 OpenNext（保留 Next） | **B. 边缘原生（Hono Worker + 媒体容器）** | C. Containers 搬移 | D. 两段式（Worker 前置 + 现有 core 容器） |
| --- | --- | --- | --- | --- |
| 改动量 | 中（Next 升级 + 适配器 + core 仍要改） | **大（core 端口）** | 小（几乎零代码） | 小 |
| 上 CF 速度 | 1–2 周 | 6–10 周 | 1–2 周 | 1 周 |
| 冷启动 | 低（Worker） | **低** | 1–3 s | 中（代理到容器） |
| 边缘收益 | 前端有，API 没有 | **全链路** | 无（等于托管 Docker） | 前端有，API 无 |
| 静态资源成本 | 低 | **零（Assets 免费）** | 低 | 低 |
| 长期维护 | 适配器升级耦合 Next | **好（Hono 原生）** | 差（单机语义） | 中（两套部署） |
| 主要风险 | Next 16 适配边界、bundle 体积 | DB 每请求模型、媒体管线拆分 | 无自动扩缩、休眠 | 长期两套系统 |

**推荐 B，并把 D 作为 B 的 Phase 1（strangler 过渡态）。** A 只在「团队坚决要保留 Next 且近期有 RSC/ISR 路线图」时考虑；C 适合先验证账单和可用性，不适合终态。

---

## 4. 推荐目标架构

```
                          ┌──────────────────────────────────────────┐
  browser / iOS ────────► │  Worker "afilmory-edge"                  │
                          │                                          │
                          │  run_worker_first:                       │
                          │   /  /photos/*  /share/*  /og/*  /api/*   │
                          │                                          │
                          │  ┌────────────┐  ┌────────────────────┐  │
                          │  │ HTML shell │  │ core Hono app      │  │
                          │  │ HTMLRewriter│ │ (tsyringe + ALS)   │  │
                          │  │ 注入        │  │                    │  │
                          │  │ __MANIFEST__│  │                    │  │
                          │  │ __CONFIG__  │  │                    │  │
                          │  └─────┬──────┘  └─────┬──────────────┘  │
                          │        │               │                 │
                          │  ┌─────▼──────┐  ┌─────▼──────┐          │
                          │  │ ASSETS     │  │ HYPERDRIVE │──────────┼──► Postgres
                          │  │ (SPA dist) │  │ (pg.Client)│          │    (Neon/Supabase/RDS)
                          │  └────────────┘  └────────────┘          │
                          │  ┌────────────┐  ┌────────────┐          │
                          │  │ KV / DO    │  │ R2 (photos)│          │
                          │  └────────────┘  └────────────┘          │
                          │  ┌────────────┐  ┌────────────┐          │
                          │  │ QUEUE      │  │ Cache API  │          │
                          │  └─────┬──────┘  └────────────┘          │
                          └────────┼─────────────────────────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │ Queue consumer (Worker)      │
                    │  → Container "media"         │
                    │    builder + sharp + exiftool│
                    │    (Cloudflare Containers)   │
                    └──────────────────────────────┘

  租户域名: Cloudflare for SaaS custom hostname ──► Worker (fallback origin)
```

### 4.1 Binding 草案（示意，不是最终配置）

```jsonc
{
  "name": "afilmory-edge",
  "main": "src/worker.ts",
  "compatibility_date": "2026-10-18",   // ≥2026-08-04 → nodejs_compat 默认开启
  "assets": {
    "directory": "./apps/web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/og/*", "/share/*", "/photos/*", "/"]
  },
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<id>" }],
  "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "afilmory-photos" }],
  "kv_namespaces": [{ "binding": "CACHE", "id": "<id>" }],
  "queues": {
    "producers": [{ "binding": "MEDIA_QUEUE", "queue": "afilmory-media" }],
    "consumers": [{ "queue": "afilmory-media", "max_batch_size": 10 }]
  },
  "durable_objects": { "bindings": [{ "name": "TENANT", "class_name": "TenantDO" }] },
  "triggers": { "crons": ["0 * * * *"] },
  "observability": { "enabled": true },
  "limits": { "cpu_ms": 30000 }
}
```

---

## 5. 逐项落地映射

### 5.1 静态 SPA + HTML 注入

现状：`apps/ssr/src/app/route.ts` 和 `[...all]/route.ts` 用 linkedom 解析 Vite 产出的 `index.html`，把 `window.__CONFIG__` / `window.__MANIFEST__` 塞进 `<script>` 标签。

目标：Worker 里读 `ASSETS.fetch(new Request('/index.html'))`，用 `HTMLRewriter` 的 `element` handler 直接改写 script 内容，零 DOM 解析库。

- `not_found_handling: "single-page-application"` 负责 SPA 回退（静态请求不计费）。
- `run_worker_first` 只把需要注入的路径交给 Worker，其余直接吃 CDN 缓存。
- 注意 Workers 的导航请求行为：设置该兼容行为后，浏览器直接访问 `/api/x` 会拿到 `index.html`——这是平台特性，接口调用请走 `fetch()`，或在 `run_worker_first` 里显式列出 `/api/*`（如上）。
- PWA 的 `VitePWA` 产物照旧，`_headers` 里补 `Cache-Control`。

### 5.2 SEO / OG

- `/photos/:photoId`：和现在一样，替换 title/og/twitter meta，只是用 `HTMLRewriter` 而不是 linkedom。
- `/og/:photoId`：satori → SVG → `@resvg/resvg-wasm` → PNG。字体（Geist / PingFang）不能放磁盘，放 R2 或直接打进 Worker（注意 64 MiB 上限，中文字体建议放 R2 + Cache API）。
- 128 MB 内存是硬上限：1200×630 的 OG 通常够用，但不要在同一个 think 里并发渲染多张；用 `Cache-Control` + Cache API 缓存结果。
- 现在 core 里的 `og.service.ts` 已经有 `cloudflare-cdn-cache-control` 头，说明这条路径本来就在为 CF 做准备。

### 5.3 数据库

- 保留 PostgreSQL。Hyperdrive 官方文档明确：**Drizzle + Hyperdrive 必须用 `pg`（node-postgres），不支持 postgres.js**。core 已经是对的；`apps/ssr` 现在用的是 `drizzle-orm/postgres-js`，随 SSR 一起被替换掉。
- **关键重构**：Workers 不允许 I/O 对象跨请求复用，模块级 `new Pool()` 会炸。改成每请求 `new Client({ connectionString: env.HYPERDRIVE.connectionString })`，`ctx.waitUntil(client.end())`；或者用 `pg.Pool` 但必须请求内创建/销毁。Hyperdrive 本身做真正的池化，所以不用担心连接数。
- 现有用 `AsyncLocalStorage` 传 transaction / `set_config('afilmory.tenant_id')` 的租户隔离逻辑可以原样保留，但要把 "shared pool" 的假设换掉（代码里已经有 `getOptionalDbContext()` 这类为请求级 client 预留的痕迹）。
- 迁移：`drizzle-kit migrate` 在本地/CI 跑，直连数据库，不走 Worker。

### 5.4 缓存 / 会话 / 限流

现有 Redis 只做三件事：任务队列（`xadd`/`xreadgroup`）、若干 `get` 缓存、限流/锁。

- 缓存 → KV（注意最终一致，TTL 最小 60 s）。
- 限流/幂等锁 → Durable Object（强一致）+ 内存态。
- 会话：`better-auth` 当前版本支持 Workers，schema 里如果已有 session 表就继续用 PG；需要缓存再叠 KV。
- **不需要** Upstash / 任何托管 Redis——除非发现漏掉的 pub/sub（`@afilmory/websocket` 在 core 里没被实际引用，注意别把文档里的示例当现状）。

### 5.5 队列

`@afilmory/task-queue` 的 Redis driver 用 `xreadgroup` 做消费组，本质是 pull 模型。映射到 Queues：

- `enqueue` → `env.QUEUE.send(msg)`（单条 ≤128 KB，大 payload 放 R2/DB，消息里只放 id）。
- `@TaskProcessor` 装饰器保留，改成一个 "handler 注册表 + `queue(batch, env)` 入口" 的适配层，尽量不动业务方法。
- 重试/退避 → Queues 内置 `max_retries` + `delaySeconds`；DLQ 用单独队列。
- 消费者 wall time 上限 15 min，CPU 最长 5 min——媒体处理不要放在 Queue consumer 里做，consumer 只负责调用容器。

### 5.6 上传

现状：`busboy` 解析 multipart，边解析边跑 builder 管线，SSE 回传进度。

目标：
1. 客户端（Web / iOS）拿预签名 URL，直接 `PUT` 到 R2（multipart 分段）；Worker 只签发和校验，不碰字节。
2. 上传完成回调 → 写 DB 记录 → 投递 `MEDIA_QUEUE`。
3. 进度：SSE 从 Worker 出，但事件源是 Durable Object（每个 upload job 一个 DO），或直接由容器流式回传再 pipe 给客户端。
4. 好处：绕开 Workers 的请求体大小/内存限制（免费 100 MB / 企业 5 GB），也绕开 `busboy`。

### 5.7 图片处理（三条路线，容器不是唯一解）

先明确现状：上传时服务端到底做了什么。`photo-asset.service.ts` → `photoBuilderService.processPhotoFromStorageObject()` →
`packages/builder` 的管线，实际只有四件事：

| 步骤 | 现在用 | 纯 JS / wasm 可行性 |
| --- | --- | --- |
| EXIF / XMP 读取 | `exiftool-vendored`（子进程 + perl） | `exifr`（纯 JS，EXIF 头在文件前 128 KB，可 range 读 R2） |
| HEIC 解码 | `heic-convert` | 已是 wasm（`libheif-js`） |
| 缩略图 / 多尺寸 | `sharp`（resize + webp/avif 编码） | Cloudflare Images 变换，或 `@jsquash/*` wasm |
| thumbhash 占位图 | `sharp` 缩到 100px + `thumbhash` | 客户端算（iOS CoreImage / Web canvas），或 wasm |

三条落地路线：

**A. 不做服务端算图（最便宜）**
原图直接进 R2 → 通过 R2 自定义域名用 Cloudflare Images 变换出缩略图/多尺寸
（HEIC 输入自 2025-07 起支持，可输出 AVIF/WebP/JPEG）。EXIF 用 `exifr` 在 Worker 里 range-read 解析；
thumbhash 由客户端在上传前算好随请求带上。**不需要容器，也不需要 wasm 图像编码。**

- 成本：Images 每月 5,000 次唯一变换免费，超出 $0.50/1,000；R2 存储 + 操作费。
- 代价：变换参数受 Images 能力约束；Live Photo 的 MOV 仍然只是原样存 R2；EXIF 的冷门标签（XMP 区域人脸等）覆盖度要逐项验证。

**B. Worker 内 wasm 算图（保留自有管线）**
`@jsquash/jpeg|webp|avif` + `libheif-js` + `exifr` + `thumbhash` 重写 `packages/builder` 的图像核心。

- 成本：$0（只有 Worker CPU）。
- 风险：128 MB 内存是硬上限，48MP 解码成 RGBA 就是 ~190 MB；必须靠解码期降采样（jpeg DCT scaling）规避，RAW 基本没戏；等于重写并重新验收整条图像管线。

**C. 容器跑现有管线（最省开发时间、保真度最高）**
现有 `Dockerfile.core` 已装好 sharp / exiftool / libvips / libheif，包一个瘦 HTTP 服务即可，由 Queue consumer 调用。

- 成本：见 §8.1，按需休眠时通常是个位数美元。
- 代价：冷启动 1–3 s（异步任务无所谓）、无内置自动扩缩、临时磁盘（产物直接写 R2）。

**建议：A 作为默认，C 作为兜底。** B 只在「必须自己控制编码参数」且愿意重写管线时考虑。

### 5.8 SSE

`createProgressSseResponse` 现在依赖请求内 `setInterval` 心跳。Workers 的入站 HTTP 请求**没有 wall time 上限**（客户端连着就一直算），所以 `streamSSE` + 循环心跳可以直接工作。

复杂点在于「进度事件来自另一个 isolate（容器/Queue consumer）」。两条路：

1. **同步代理**：Worker 把上传请求直接转发给容器，容器的响应流就是 SSE，Worker 透传。最简单，保留现有语义。
2. **DO 中转**：每个 job 一个 DO，容器往 DO 写事件，客户端 SSE 从 DO 读。解耦，但多一层。

### 5.9 定时任务

| 现状 | 目标 |
| --- | --- |
| `cleanup-sweep.scheduler.ts`（`setInterval`） | Cron Trigger，每小时一次 |
| `account-deletion.queue.ts` 的恢复定时器 | DO alarm（精确、按对象） |
| 长任务的超时/重试 | Workflows（可选） |

Cron 单次 wall time 15 min / CPU 15 min，足够清理类任务；超长任务拆成 Queue 批次。

### 5.10 认证

- `better-auth` 1.7.x 支持 Workers；`@apple/app-store-server-library` 依赖 `node:crypto`（nodejs_compat 已覆盖）。
- `resend` 是 fetch 客户端，没问题。
- `ejs` 模板是纯 JS，可以保留（或改成模板字符串）。
- 注意 `process.env`：兼容日期 ≥ 2025-04-01 时 Workers 会用 bindings 自动填充 `process.env`，所以 `@afilmory/env` 这个模块级单例**大概率不用重写**——但仍建议在 spike 里验证（见 §7）。

### 5.11 自定义域名 / 多租户

- 现在已经在用 Cloudflare for SaaS 的 custom hostname API（`cloudflare-custom-hostname.service.ts`）。
- 迁移后把这些 hostname 的 fallback origin 指向 Worker（Cloudflare 官方支持 "Workers as your fallback origin"），Worker 用 `Host` header 解析 tenant。
- 这样租户域名不需要 per-tenant Worker，也不需要 Workers for Platforms。

### 5.12 构建与 CI

- 新增 `wrangler.jsonc` + `@cloudflare/vite-plugin`（保留现有 Vite + SWC 构建，`emitDecoratorMetadata` 依赖 SWC，esbuild 不支持）。
- 产物：`apps/web/dist`（assets）+ Worker bundle。
- 媒体容器单独 `wrangler deploy`（`containers[].image` 指向 Dockerfile）。
- 迁移脚本在 CI 里用直连字符串跑，不在 Worker 里跑。
- 回滚：Workers Versions + `wrangler rollback`；数据层回滚靠 PG。

---

### 5.13 存储：R2 只是可选项，不是前提

现有模型本来就是多 provider：`StorageFactory` 支持 `s3 / b2 / oss / cos / github / local / eagle`，
并且区分 **平台托管（managed storage）** 与 **租户自带（BYO）**——每个租户的配置存在 `settings` 表里
（`storage-setting` 模块），`ManagedStorageProvider` 还会在 key 上拼 `tenantId/` 前缀做隔离。

所以 Cloudflare 迁移**不能把 R2 写死**，只要保证三件事：

| 能力 | R2 | 租户自带 S3 兼容桶 |
| --- | --- | --- |
| 读对象 | R2 binding（零 egress、无需签名） | Worker 内用 `aws4fetch` 签名请求（租户凭据从 `settings` 解密取） |
| 写对象 | binding 直写 / 预签名直传 | 预签名直传，或 Worker 流式 PUT（受 Cloudflare 请求体上限：免费/Pro 100 MB、Business 200 MB） |
| 派生图（缩略图/多尺寸） | `/cdn-cgi/image/` + R2 自定义域名 | **Images binding**（`env.IMAGES.input(stream).transform().output()`，对任意流生效，不要求源站挂在 CF 上） |

实践建议：**把派生图和平台级缓存统一落到 R2，原图留在租户自己的桶里**。这样
(a) 换 provider 不影响画廊性能，(b) 不用对每个租户域名都做 CF 代理，(c) Images 变换只对 R2 对象计费。

代价是 Worker 侧要处理租户凭据（需要确认 `settings` 里凭据是否加密存储——这本来就是安全债，
迁移前应一并清理），以及 BYO 桶的延迟会直接体现在首次读上（可加 Cache API 缓解）。


## 6. 分阶段路线

| 阶段 | 内容 | 产出 / 验收 | 估计 |
| --- | --- | --- | --- |
| **P0** 边缘前端 | `apps/web` 部署到 Workers Assets；Worker 读 assets 注入 `__CONFIG__` / `__MANIFEST__`（manifest 先取 R2/打包 JSON）；`/og/:id` 用 satori + resvg-wasm（字体走 R2） | 官网/画廊在 CF 上可访问，Lighthouse 与现网持平，OG 卡片正常 | 1–1.5 周 |
| **P1** 网关 | Worker 接管 `/api/*` 与 `/photos/*`，未迁移路径反向代理到现有 core（先跑在 Containers 或原 VPS） | 自定义域名切到 CF，移动端零改动可用 | 1 周 |
| **P2** core 端口 | 按模块 strangler：manifest 读 → 照片读 → reactions/comments → auth/billing 读路径；DB 改每请求 client；Redis → KV/DO；静态服务删除 | 读路径 100% 在 Worker；容器只承担写/媒体 | 4–6 周 |
| **P3** 媒体管线 | builder 容器化 + Queue 驱动 + R2 直传 + 进度 SSE | 上传不经过 Worker 字节流；P95 处理时延可观测 | 1.5–2 周 |
| **P4** 收尾 | Cron、告警、限流、成本看板、旧容器下线 | 单点（Container）只在异步路径 | 1 周 |

每个阶段都可独立上线、独立回滚。P1 之后就有「Cloudflare 上线」的可见成果，不必等 core 全量端口。

---

## 7. 风险清单与验证 Spike

| 风险 | 影响 | 缓解 | 验证方式 |
| --- | --- | --- | --- |
| `emitDecoratorMetadata` 在 Worker 构建链丢失 → tsyringe 解析不到依赖 | 高（全后端） | 保留 Vite + SWC；不行就显式 `@inject(TOKEN)` | Spike 4 |
| 每请求 DB client 与现有事务/ALS 语义冲突 | 高 | 把 `DbContext` 生命周期收敛到请求；补集成测试 | Spike 3 |
| 128 MB 内存（manifest 聚合、OG、字体） | 中 | manifest 落 R2 流式返回；OG 单张 + 缓存；字体按需 | Spike 2 |
| 大 gallery（1000 张）构建 manifest 超出 5 min CPU | 中 | 拆 Queue 分批 + DO 汇总 | 压测 |
| `better-auth` / `@apple/app-store-server-library` 在 workerd 的兼容性 | 中 | 早期 spike；必要时这部分留容器 | Spike 6 |
| SSE 进度需要跨 isolate | 中 | 同步代理容器流 或 DO 中转 | P3 原型 |
| Containers 无自动扩缩、冷启动 1–3 s | 中 | 异步化 + `getRandom` + 监控 | Spike 5 |
| 双栈期数据一致性 | 中 | 单写：写路径只在一个地方 | 设计评审 |

**建议先花 2–3 天做 6 个 spike，再决定是否投入 P2：**

1. `apps/web` 部署到 Workers Assets + 注入 manifest，跑通首页与 viewer。
2. 最小 Worker：satori + `@resvg/resvg-wasm` 渲染一张带中文的 OG，记录内存峰值。
3. 最小 Worker：`pg.Client` + Hyperdrive + `set_config('afilmory.tenant_id')` + 一条 RLS 查询。
4. 用现有 Vite 配置把 `be/apps/core` 打成 Worker bundle：看装饰器元数据是否存活、bundle 大小、startup 时间（<1 s 限制）。
5. 现有 `Dockerfile.core` 部署到 Containers，测冷启动、内存、`/api/health`。
6. `better-auth` 登录 + session 在 Worker 上跑通。

---

## 8. 成本估算（量级，非报价）

### 8.1 容器到底要多少钱

Workers Paid（$5/月）已经包含：**25 GiB-小时内存 + 375 vCPU-分钟 + 200 GB-小时磁盘**，超出部分
内存 $0.0000025/GiB-秒、CPU $0.000020/vCPU-秒、磁盘 $0.00000007/GB-秒；**休眠期间不计费**。

`basic` 规格（1 GiB / 0.25 vCPU / 4 GB 磁盘）三档场景：

| 场景 | 月用量 | 费用 |
| --- | --- | --- |
| 媒体 worker 按需唤醒，每月累计跑 2 小时 | 2 GiB-h、30 vCPU-min、8 GB-h | **$0**（全在额度内） |
| 每月累计跑 20 小时 | 20 GiB-h、300 vCPU-min、80 GB-h | **$0**（仍全在额度内） |
| 7×24 常驻 | 730 GiB-h（超 705）、CPU 空闲≈0、磁盘 2,920 GB-h（超 2,720） | 约 **$7/月** |
| 7×24 常驻且 CPU 50% 忙 | 同上 + 5,100 vCPU-min 超出 | 约 **$13/月** |

也就是说：**媒体处理用容器，正常量级下几乎不额外花钱；只有"把 API 常驻在容器里"才会到 $7–13/月**，
这仍然低于一台同规格 VPS。"容器很贵"的印象多半来自 AWS Fargate / ECS 的常驻计费模型。

### 8.2 三套方案的月度账单

假设：10 万 PV/月、图片 100 万次/月、API 500 万请求/月、每月新增 5,000 张照片。

| 项目 | Cloudflare（路线 A：不用容器） | Cloudflare（路线 C：媒体容器） | Vercel |
| --- | --- | --- | --- |
| 平台费 | Workers Paid $5 | Workers Paid $5 | Pro $20/席（含 $20 用量抵扣） |
| 静态资源 | 免费、无限 | 免费、无限 | 1M CDN 请求 + 1 TB 流量含在计划内 |
| 图片变换 | 5,000 次唯一变换免费，超出 $0.50/1k | — | 图片优化按源图计费（含 5K/月） |
| R2 / 存储 | ~$10–25（500 GB） | 同左 | Blob 含 1 GB，超出另计 |
| 容器 | $0 | $0–7 | — |
| 函数/CPU | $0（含 3,000 万 CPU-ms） | 同左 | Active CPU $0.128/h、内存 $0.0106/GB-h、调用 $0.60/M ≈ $8–15 |
| Queues | ~$0–2 | ~$0–2 | Queues（Beta）按操作计费 |
| Hyperdrive | $0（付费计划内不限查询） | $0 | — |
| Postgres | 外部 $15–50 | 外部 $15–50 | 外部 $15–50 |
| **合计** | **约 $30–80** | **约 $30–85** | **约 $45–90** |

结论：三者的量级差别不大（Vercel 平台费高 $15，Cloudflare 存储/流量更便宜）。
**真正的差别不在账单，而在工作量**：Vercel 能把 `apps/ssr` 直接跑起来，但 `be/apps/core` 的常驻语义
（SSE、`setInterval`、`ioredis` TCP、exiftool 二进制、模块级连接池）在 Vercel Functions 里同样要重构——
只是把"迁移到 CF"换成了"改造成 Serverless"，并不省事。

### 8.3 与现状对照

1 台 VPS（4C8G）+ 对象存储 + 带宽通常 $40–80/月，但要自己承担运维、扩缩、证书、CDN。
CF 方案的主要收益不是省钱，而是**免运维 + 全球边缘 + 静态/图片零 egress**；若只追求最低账单，
路线 A + 小规格外部 Postgres 可以把总成本压到 $30/月上下。

---

## 9. 全量迁移（含 Postgres → D1）专项评估

### 9.1 结论

技术可行，但 **D1 是整条迁移里性价比最差的一项**：它把「保留一个外部依赖」换成「重写 schema + 事务模型 +
多租户分库」，省下的只是每月 $15–50 的 Postgres 账单和一跳网络。

| 范围 | 工作量（单人） |
| --- | --- |
| 其余 Cloudflare 迁移（§6 P0–P4） | 7–10 周 |
| **D1 替换 Postgres（§9.3）** | **60–90 人日 ≈ 12–18 周** |
| 合计（全量、单人） | **约 5–7 个月** |
| 合计（两人并行；D1 与 Worker 端口可并行） | 约 3–3.5 个月 |

建议：**保留 PG + Hyperdrive**；若确实要 D1，只把新增的、无事务需求的模块（评论、反应、计数）先落到
D1 做试点，核心账务/权益表不要动。

### 9.2 现状盘点（决定工作量的硬事实）

| 项 | 数量 | D1 影响 |
| --- | --- | --- |
| 表 / 建表语句 / 迁移文件 | 37 / 42 / 30 | schema 需用 sqlite dialect 重新生成，30 个 PG 迁移不可复用 |
| `pgEnum` | 19 | SQLite 无 enum → TEXT + 应用层校验 |
| `jsonb` 列 | 15（迁移里 24 处） | `text({ mode: 'json' })`；`jsonb_*` / `#>>` / `::jsonb` 查询要改写 |
| `timestamp` 列 | 108（`defaultNow()` 74 处） | 改 `integer({ mode: 'timestamp' })` 或 TEXT；`now()` → `unixepoch()` |
| `boolean` / `bigint` / `text` | 12 / 5 / 176 | boolean → 0/1；bigint(mode:number) 在 2^53 内可用 |
| unique / index / PK / FK | 27 / 42 / 9 / 1 | 可平移；外键需 `PRAGMA foreign_keys=ON` |
| 查询调用点 / 涉及文件 | **365 / 54** | 约 15%–20% 含 PG 专属语法 |
| **交互式事务** | **13 处** | **D1 没有 `BEGIN…await…COMMIT`，只能 `batch()`** |
| PG 专属函数/语法 | `date_trunc` 8、`interval` 5、`to_char` 1、`generate_series` 1、`jsonb_*` 3、`#>>` 2、`::int` 19、`ilike` 8、`for update` 1、`lateral` 1 | 逐条改写或上移应用层 |
| RLS / 触发器 / 扩展 / GIN | **0** | 唯一的好消息：没有需要移植的数据库侧逻辑 |
| 主键类型 | Snowflake，`text` | 精度安全（不是 64-bit 数字） |

### 9.3 逐项改造与工期

| 工作项 | 内容 | 人日 |
| --- | --- | --- |
| Schema 重写 | 19 enum→text、15 jsonb→json text、108 timestamp、默认值、索引/唯一键、`drizzle-kit` sqlite 生成 | 6–9 |
| Provider 适配 | `drizzle-orm/d1` 替换 `node-postgres`，`db.execute().rows` 语义（6 处）、绑定参数上限 100、单次 1000 查询 | 3–5 |
| 查询改写 | `ilike`(8)、`FILTER`(15，需验证 SQLite 版本)、`date_trunc`/`generate_series`/`to_char` 聚合、jsonb 路径、`::int` | 9–14 |
| **事务重写** | 13 处 read-modify-write：改 `batch()`、或 DO 串行化、或补偿事务 + 幂等键 | **12–18** |
| 认证/会话 | better-auth 换 SQLite/D1 adapter，session/verification 表改造 | 3–5 |
| 数据迁移 | PG→D1 转换脚本（jsonb/时间/enum）、`wrangler d1 import`、分批、断言对账 | 6–9 |
| 多租户分库 | 10 GB 硬上限 → 控制面 DB + 每租户 DB；迁移编排 + 跨租户聚合（超管看板/清理/计费）扇出 | 12–18 |
| 测试与切换 | 双跑、差分、回滚预案、压测（单库单线程！） | 10–14 |
| **合计** | | **61–92** |

### 9.4 三个真正的难点

1. **没有交互式事务。** `account-deletion-executor.ts` 里 `select … for update` 之后还有多次写；
   `billing-entitlement.service.ts`、`photo-asset.service.ts` 的 upsert 流程都是「读→算→写」。
   D1 的 `batch()` 只能提交一串预先确定的语句，不能中途读结果再决定。
   要么把逻辑压成单条 SQL，要么用 **Durable Object 做每租户事务协调器**（串行化），要么改乐观并发 + 幂等。
   这一项直接决定计费/权益的正确性，是最大的风险点。
2. **10 GB 硬上限 + 单库单线程。** `photo_asset.manifest` 是整份 manifest 的 jsonb，单行 KB 级；
   单库能撑到百万级照片，但上限不可提升。多租户 SaaS 早晚要分库，而分库后超管看板、清理任务、
   计费聚合都要跨库扇出；D1 绑定数量也有限制（约 5,000 个/Worker）。
3. **聚合 SQL。** 仪表盘的 `generate_series + date_trunc + to_char`、热门标签的
   `jsonb_array_elements_text`、设备统计的 `#>>` 都要重写；SQLite 的 JSON1/FTS5 能覆盖大部分，
   但 `generate_series` 只能换递归 CTE 或应用层补月份。

### 9.5 数据迁移方案

1. **不迁移历史 migration**：用 `drizzle-kit generate --dialect sqlite` 从新 schema 生成 0000。
2. **转换**：`jsonb → TEXT`（原样 JSON 字符串）、`timestamp → INTEGER(epoch)` 或 ISO TEXT、
   `enum → TEXT`、`boolean → 0/1`。
3. **导入**：小数据 `wrangler d1 import --file`（单文件上限 5 GB）；或写一次性脚本，经 Hyperdrive 读 PG、
   `batch()` 写 D1（每批 ≤1000 语句 / ≤100 参数）。
4. **对账**：行数、抽样行 hash、金额/权益计数三类断言；不通过不切流量。
5. **切换**：停写窗口内做最终增量，或双写 + 读校验；回滚靠保留 PG 只读副本。

### 9.6 什么情况下 D1 才值得

- 数据量可预期地 < 10 GB，且短期内不会靠分库解决增长；
- 能接受事务模型重设计（或业务本身没有跨表事务）；
- 强诉求是「完全不加外部依赖 / 只走 Cloudflare 计费与合规 / 全球读复制」；
- 租户数量少（< 100），不需要控制面/数据面拆分。

四条里只要有一条不满足，**保留 Postgres + Hyperdrive 都是更优解**——它已经是官方推荐的 Drizzle 组合，
成本 $15–50/月，换掉它省不下钱，却要付出上表 60–90 人日。

---

## 10. 明确不建议的做法

1. **D1 替换 Postgres**：10 GB/库硬上限、单库单线程、无交互式事务，37 张表 + 15 个 jsonb 全要重写，详见 §9（60–90 人日）。
2. **Cloudflare Pages 新起项目**：静态资源已并入 Workers，Pages 不是新项目的主线。
3. **长期用 Containers 跑 API 单体**：没有内置自动扩缩、冷启动 1–3 s、按秒计费，等于把 VPS 的运维问题换成了平台限制。
4. **Workers for Platforms**：除非要做「每个租户一个独立 Worker + 独立代码」，当前单 Worker + CF for SaaS 足够。
5. **为了"能上 CF"切到 D1 + next-on-pages + 托管 Redis 的全新栈**：三个迁移同时做，风险相乘。

---

## 11. 参考

- OpenNext Cloudflare 适配器：<https://opennext.js.org/cloudflare> · <https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/>
- `@opennextjs/cloudflare` 版本与 peer 约束：<https://www.npmjs.com/package/@opennextjs/cloudflare>
- Workers 静态资源 / SPA 路由：<https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/>
- Workers 限制（128 MB、CPU 5 min、子请求、6 连接）：<https://developers.cloudflare.com/workers/platform/limits/>
- Workers 计费：<https://developers.cloudflare.com/workers/platform/pricing/>
- Hyperdrive + Drizzle（必须用 `pg`）：<https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/>
- D1 限制：<https://developers.cloudflare.com/d1/platform/limits/> · FAQ（10 GB 硬上限、单库单线程、`batch()`）：<https://developers.cloudflare.com/d1/reference/faq/>
- D1 支持的 SQL / JSON / FTS5：<https://developers.cloudflare.com/d1/sql-api/sql-statements/>
- Queues 限制：<https://developers.cloudflare.com/queues/platform/limits/>
- Containers 计费 / 限制 / FAQ（冷启动 1–3 s、无自动扩缩）：<https://developers.cloudflare.com/containers/platform/pricing/> · <https://developers.cloudflare.com/containers/platform/limits/> · <https://developers.cloudflare.com/containers/faq/>
- Cloudflare for SaaS：Workers 作为 fallback origin：<https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/>
- Workers AsyncLocalStorage：<https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/>
- 兼容性开关（`nodejs_compat` 默认、`process.env` 自动填充）：<https://developers.cloudflare.com/workers/configuration/compatibility-flags/>
