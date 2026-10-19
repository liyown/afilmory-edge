# Cloudflare 个人部署迁移 — Agent 执行计划

Status: **ready to execute**（等待人工解锁项，见 §3）
Date: 2026-10-19
Target reader: **执行这个计划的 agent**。本文件不按"人日"编排；单位是**任务（T）**、**依赖**、**验收证据**。

关联：[迁移可行性调研](../specs/2026-10-19-cloudflare-migration-design.md)（多租户 SaaS 视角，本计划不采用其中 §9 的 D1 分库方案）。

---

## 执行状态（滚动更新）

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| H1 登录 | ✅ | `cf auth whoami` → liuyaowen.smile@gmail.com / account `4104edd6…f902` |
| H3 域名 | ✅ 临时 | 用 `*.workers.dev`，无需绑定 |
| T0.1 骨架 | ✅ | `cf init workers apps/edge --no-install`；`cf build` 产出 `.cloudflare/output/v0/.../bundle/index.js`；`cf dev` 后 `curl :5173/health` → `{"ok":true,"worker":"afilmory-edge",...}` |
| T0.2 装饰器门禁 | ✅ **通过** | `curl :5173/api/spike/decorators` → `{"ok":true,"message":"hello tsyringe!","metadata":["Suffix"]}`。SWC 的 `emitDecoratorMetadata` 在 workerd 生效，§2.1 路线成立 |
| T0.3 bindings | ✅ **通过** | `curl :5173/api/spike/bindings` → `{"d1":{"ok":1},"r2":{...,"body":"hello-r2"},"kv":{"value":"hello-kv"}}`；`cloudflare.config.ts` 已声明 D1/R2/KV/ASSETS |
| T1.1 Web 产物 | ✅ | `AFILMORY_EMBED_MANIFEST=false vite build`；`dist/index.html` 含空 `<script id="manifest">` 与默认 `<script id="config">`；dist 32 MB |
| T1.2 静态托管 | ✅ | `vite.config.ts` 的 `publicDir` 指到 `apps/web/dist`；`cf build` 产出 `.cloudflare/output/v0/workers/default/assets/`（33 个文件）；`cf dev` 下 `/favicon-32x32.png` → `200 image/png` |
| T1.3 manifest 注入 | ✅ | `HTMLRewriter` 改写 `<script id="manifest">`；seed R2 后 `curl /` 得到 `window.__MANIFEST__ = {"version":"v0","data":[{"id":"spike-photo"...}]}`，响应头 `x-ssr: 1`；`/api/manifest` 走 KV 60s 缓存 |
| T1.4 照片详情 meta | ✅ | `/photos/spike-photo` 注入 og/twitter（含 `property=` 与 `name=` 两种 twitter 形态的清理）、`<title>`；未知 id 返回 404 |
| T1.5 OG 渲染 | ✅ | 改用 **workers-og**（自带 workerd 适配的 satori + resvg-wasm，HTML 字符串输入）；`/og/spike-photo` → `200 image/png`、1200×630、82 KB，肉眼核对排版/字体正常。直接引 satori 会在 harfbuzz 初始化时报 `reading 'href'`，已弃用 |
| **T1.6 首次部署** | ✅ | `https://afilmory-edge.liuyaowen-smile.workers.dev`；startup 32 ms；`/health`、`/`、`/photos/:id`、`/og/:id`、`/api/manifest` 全部线上验证通过 |
| T2.1 D1 schema | ✅ | 新增 `be/packages/db/src/schema.sqlite.ts`（15 表：含 `tenant_membership`/`system_setting`，因为保留代码仍在用）+ `drizzle.config.sqlite.ts` + `migrations-sqlite/0000_heavy_skin.sql`；`pnpm --filter @afilmory/db type-check` 通过。时间戳用 ISO 文本而非 epoch，避免改动现有 `.toISOString()` 调用点 |
| T2.2 D1 provider | ✅ | 新增 `database.d1.provider.ts` / `database.d1.module.ts`；edge 构建把 `@core/database/database.{provider,module}` 与 `@afilmory/db` 别名到 D1/SQLite，业务代码零改动。`curl :5173/api/health` → `{"status":"ok",...,"tenant":{"id":"1","slug":"root","status":"active"}}`。`generateId` 改为 Worker 原生雪花（`nodejs-snowflake` 依赖 WASM+`__dirname`，workerd 不可用） |
| T2.3 事务改写 | ✅ | 个人版路径上的 4 处交互式事务已清除：`ManifestSyncService` 改为「单条 `UPDATE ... RETURNING` 分配 revision + batch 内子查询写入 changes + 剪枝」，photo 删除合并为单个 plan，上传/更新改为「单条 upsert + 幂等 change batch」。`node:sqlite` 回归测试 5/5 通过（含双连接并发 revision 唯一性、重复删除不产生重复行） |
| T0.4 裁剪 core | 🚧 模块图完成 | `personal.module.ts` 修正 import 路径、补齐全局 middleware/guard/interceptor；新增 `InProcessEventModule`（§2.6，去掉事件对 Redis 的依赖）。已删除 `activity`、`super-admin`、`featured-galleries`、`gallery-subscriptions`、`mobile`、`user-safety`、`account-deletion`、`static-web`、`mail`、`index.module.ts`；`app.factory` / `openapi` 已切到 `PersonalModule`；`tsc --noEmit` 通过。**仍待**：billing/managed-storage/push/data-sync 与 photo/system-setting 解耦（与 T4 上传重写重叠），以及 billing 本身删除 |

**线上资源（`cf deploy --provision` 创建）**

| Binding | 资源 | ID |
| --- | --- | --- |
| `CACHE` | KV Namespace | `e2c83a08e73246e98f62306bd72e15d9` |
| `DB` | D1 Database | `afilmory-db` |
| `PHOTOS` | R2 Bucket | `afilmory-photos` |

部署命令注意：`pnpm --filter @afilmory/edge deploy` 会命中 pnpm 内置的 `deploy` 子命令并报
`ERR_PNPM_INVALID_DEPLOY_TARGET`；必须用 **`pnpm -C apps/edge run deploy`**（或 `pnpm run deploy`）。

**工具链是新的 `cf` CLI（v1.0.0-beta.18），不是 wrangler。** 项目结构：

```
apps/edge/
  cloudflare.config.ts   # defineConfig({ worker: {...}, env: bindings.* })
  vite.config.ts         # @cloudflare/vite-plugin + swc（待验证）
  src/index.ts           # Worker 入口（Hono 之后替换）
  src/decorator-spike.ts # T0.2 门禁
```

**已知问题（T0.2 阻塞项）**：本机 pnpm 12.3.2 的 virtual store 里缺少带 peer 哈希的包目录
（`@cloudflare/vite-plugin@1.64.0_…`、`cf@1.0.0-beta.18…` 都不存在），而 `apps/edge/node_modules`
的软链指向一个不存在的无哈希路径；`pnpm install` / `--force` / `pnpm add` 都报 "Already up to date"
并且不会重新下载。**这是本地依赖状态问题，不是方案问题**——同一份 `package.json` 在干净环境
（CI 或新 clone）里能正常安装，首次 `cf build` 已经验证过一次产物。

恢复步骤（任一）：

```bash
# A. 清空 store 后重装（推荐）
rm -rf node_modules apps/*/node_modules be/apps/*/node_modules
pnpm store prune
pnpm install

# B. 换 pnpm 11（与 be/apps/* 里 packageManager 一致）
corepack prepare pnpm@11.1.2 --activate
pnpm install
```

装好后用 `pnpm --filter @afilmory/edge dev` + `curl :5173/spike/decorators` 收门禁证据：
期望 `{ ok: true, message: "hello tsyringe!", metadata: ["Suffix"] }`。若 `metadata` 为 `undefined`，
说明 SWC 没生效，走 §7 的回退（显式 `@inject`）。

---

## 0. 目标与非目标

**目标**：把这套画廊迁移成「Cloudflare 上的单站点个人部署」，功能不阉割：

- 访客：画廊、照片详情、地图、OG 卡片、feed、评论/反应
- 站长：登录 dashboard、上传（含批量 / Live Photo / 大文件）、删除、改设置
- iOS App：现有 REST + SSE 契约不变

**非目标（明确不做）**：多租户、租户自定义域名、计费/订阅、超管、托管存储、账号注销流程。
这些模块**不删除源码**，只是不注册进个人版入口（见 §2.1）。

**成功定义**：见 §6。

---

## 1. 平台约束（编码时必须遵守）

| 约束 | 值 | 影响 |
| --- | --- | --- |
| Worker 内存 | 128 MB | 禁止在 Worker 里解码大图 |
| 请求体 | 100 MB（Pro）/ 200 MB（Business） | 上传必须**直传**，不经过 Worker |
| 静态资源请求 | 免费、无限 | SPA / dashboard / 缩略图优先走 static |
| CPU | 默认 30 s，可调至 5 min | 仅用于 manifest 组装、OG、EXIF |
| 静态资源数量 | 100,000 个/版本 | 缩略图不要打进 assets |
| 兼容日期 | ≥ 2026-08-04 | `nodejs_compat` 默认开启，`process.env` 自动填充 |

---

## 2. 架构决策（已定，执行时不要再讨论）

### 2.1 按需保留：删掉不用的代码，不追求与上游一致

个人部署只保留「画廊 + 上传 + 评论/反应 + 设置 + 登录」。**未使用的模块、表、依赖直接删**，
不要用开关或空实现去兼容上游。

保留并注册进 `be/apps/core/src/personal.module.ts`：

```
DatabaseModule, AppStateModule, SettingModule, SiteSettingModule, StorageSettingModule,
BuilderSettingModule, ManifestSyncModule, PhotoModule, CommentModule, ReactionModule,
FeedModule, OgModule, HealthModule, WellKnownModule, AuthModule, DashboardModule
```

**删除清单（T0.4 执行）**

| 类别 | 删除对象 |
| --- | --- |
| 模块 | `platform/billing/**`、`platform/super-admin/**`、`platform/tenant/tenant-domain.*`、`platform/managed-storage/**`、`platform/gallery-subscriptions/**`、`platform/user-safety/**`、`platform/account-deletion/**`、`platform/featured-galleries/**`、`platform/activity/**`、`platform/mobile/mobile-storage-handoff*`、`platform/push-notifications/**`（除非要推送）、`infrastructure/static-web/**`、`infrastructure/data-sync/**` |
| 表 | `tenant_domain`、`tenant_membership`、`gallery_subscription`、`apns_device`、`apple_authorization`、`account_deletion_request`、`billing_*`(7)、`managed_storage_*`(2)、`content_report`、`user_block`、`super_admin_audit_log`、`tenant_cleanup_*`(2)、`platform_activity_event`、`mobile_storage_handoff`、`system_setting` |
| 依赖 | `ioredis`、`@afilmory/task-queue`、`@afilmory/redis`、`@resvg/resvg-js`、`pg-native`、`busboy`、`ejs`(若模板被替换)、`@apple/app-store-server-library`、`@creem_io/better-auth`、`resend`(若无邮件) |
| Dashboard | **保留整个 `be/apps/dashboard` 应用**（上传、照片库、设置、统计都在这里），只删其中的 `super-admin/**`、`billing/**`、`managed-storage/**` 页面 |

删除后 `be/apps/core/src` 预计从 343 个文件降到 ~120。表从 37 张降到 10 张（见 §2.3）。

**实测依赖（2026-10-19）**：这张表低估了耦合——`billing` 被 `AuthModule`/`TenantModule`/`PhotoModule`/`StorageSetting`/`SystemSetting` 引用，`user-safety` 被 `CommentModule` 引用，`push-notifications`/`managed-storage`/`data-sync` 被 `PhotoModule` 引用。正确顺序是**先解耦调用点，再删文件**；photo 相关的解耦与 T4 上传重写重叠，放到 T4 一起做。

**保留 `tenant` 表 + 固定一行**：`photo/comment/reaction` 里 `tenantId` 过滤有几百处，
删掉它属于纯机械重构、收益为零、风险很高；保留单行 tenant 是唯一合理的「零改动」做法。

### 2.2 单租户用 shim，不改业务代码
`requireTenantContext()` 被大量服务调用，**保留 tenant 概念**：数据库里固定一行 tenant，
`TenantResolverInterceptor` 在个人版里改为「永远解析到该行」。这样 photo/comment/reaction 一行不用改。

### 2.3 数据库：D1，单库
保留 11 张表：`tenant`、`auth_user`、`auth_session`、`auth_account`、`auth_verification`、
`settings`、`photo_asset`、`tenant_manifest_state`、`tenant_manifest_change`、`photo_sync_run`、
`comment`（+ `comment_reaction`、`reactions` 若保留互动）。
单库、不分片；10 GB 对个人画廊足够。

### 2.4 上传：直传 + 元数据
浏览器/App 拿预签名 URL 直接 PUT 到 R2（>100 MB 用 multipart）；Worker 只负责签名、校验、EXIF、manifest。
**不用 busboy**，不经过 Worker 转发字节。

### 2.5 缩略图：Cloudflare Images 变换（默认）
原图进 R2，缩略图由 `/cdn-cgi/image/...` 即时生成并缓存。Worker 里只生成 URL，不算图。
备选（T5.5，默认不做）：wasm 自算。

### 2.6 去掉 Redis / 任务队列
`EventModule`（SSE 广播）改为进程内事件总线；`setInterval` 改 Cron；队列暂不需要（个人场景同步处理即可）。

### 2.7 新应用：`apps/edge`
替换 `apps/ssr`（Next 不再使用）。`apps/edge` = Hono Worker + `cloudflare.config.ts` + Vite 构建。

**线上资源（`cf deploy --provision` 创建）**

| Binding | 资源 | ID |
| --- | --- | --- |
| `CACHE` | KV Namespace | `e2c83a08e73246e98f62306bd72e15d9` |
| `DB` | D1 Database | `afilmory-db` |
| `PHOTOS` | R2 Bucket | `afilmory-photos` |

部署命令注意：`pnpm --filter @afilmory/edge deploy` 会命中 pnpm 内置的 `deploy` 子命令并报
`ERR_PNPM_INVALID_DEPLOY_TARGET`；必须用 **`pnpm -C apps/edge run deploy`**（或 `pnpm run deploy`）。

**工具链是新的 `cf` CLI（v1.0.0-beta.18），不是 wrangler。** 命令对照：

| 用途 | 命令 |
| --- | --- |
| 脚手架 | `cf init workers <dir>` |
| 本地开发（本地模拟资源） | `cf dev` / `cf dev --local --persist-to ~/.config/cloudflare/state` |
| 构建 | `cf build`（产物是 Build Output Specification） |
| 部署 | `cf deploy`（`--provision` 会自动创建缺失的绑定资源，`--dry-run` 只构建校验） |
| D1 | `cf d1 create|list|query|migrations` |
| R2 | `cf r2 buckets|objects` |
| KV | `cf kv namespaces|keys` |
| 认证 | `cf auth login|whoami`（已登录：liuyaowen.smile@gmail.com） |

配置写在 `apps/edge/cloudflare.config.ts`：`defineConfig({ worker: { name, compatibilityDate, entrypoint, env, assets, triggers, limits, observability } })`，绑定用 `bindings.d1({name})` / `bindings.r2({name})` / `bindings.kv({id})` / `bindings.assets()`。
`apps/ssr` 保留到 T7.4 再删除。

---

## 3. 人工解锁项（agent 无法自行完成，先列出来）

| ID | 事项 | 谁做 | 阻塞哪些任务 |
| --- | --- | --- | --- |
| H1 | ~~Cloudflare 登录~~ **已完成**：`cf auth whoami` → liuyaowen.smile@gmail.com | — | — |
| H2 | R2 bucket / D1 / KV 的创建（可用 `cf deploy --provision` 自动创建，或人手动建） | 人确认命名 | T0.3 之后 |
| H3 | 域名：先用 `*.workers.dev` 临时域名，无需操作 | — | 不阻塞 |
| H4 | 决定缩略图路线（默认 Images） | 人 | T5.x |
| H5 | 迁移现有数据（是否已有线上 PG 数据要搬） | 人 | T2.5 |
| H6 | APNs 证书/Key（仅当要保留推送） | 人 | T8 |

> **当前状态：H1/H3 已解锁。** Agent 用 `cf dev`（本地模拟）+ `cf build --dry-run` 即可推进全部开发，
> 只有 `cf deploy` 会改动线上资源；首次部署前用 `cf deploy --dry-run` 确认产物。

---

## 4. 任务图

```
T0.1 ── T0.2 ── T0.3 ─┬─ T1.1 ── T1.2 ── T1.3 ── T1.4 ── T1.5 ── T1.6
                      │
                      ├─ T2.1 ── T2.2 ── T2.3 ── T2.4 ── T2.5
                      │
                      └─ T3.1 ── T3.2 ── T3.3
                                        │
T1.6 + T2.5 + T3.3 ─────────────────────┴─ T4.1 ── T4.2 ── T4.3 ── T4.4 ── T4.5 ── T4.6
                                                                              │
                                                     T4.6 ── T5.1 ── T5.2 ── T5.3
                                                                              │
                                                     T5.3 ── T6.1 ── T6.2 ── T7.1 ── T7.4
```

**可并行轨道**（agent 应在一条轨道等待构建/部署时推进另一条）：
- 轨道 A（前端/边缘）：T1.x
- 轨道 B（数据）：T2.x
- 轨道 C（认证/后台）：T3.x
- 轨道 D（上传）：T4.x（依赖 A+B+C 的产物，但 T4.1 的签名逻辑可以先写）

---

## 5. 任务清单

每个任务必须产出：**改动文件清单 + 可复现的验证命令 + 证据（命令输出/截图/curl 结果）**。
没有验证证据的任务不算完成。

### Phase 0 — 骨架与可行性门禁

**T0.1 创建 `apps/edge` 骨架**
- 状态：**已完成**（`cf init workers apps/edge --no-install`；`cloudflare.config.ts` 指向 `afilmory-edge`；
  根脚本 `dev:edge` / `build:edge` / `deploy:edge` 已加）。
- 验收：`cf dev` 后 `curl localhost:<port>/health` 返回 `{ok:true}`。
- 回退：无（新增目录）。

**T0.2 装饰器构建链 spike（门禁）**
- 动作：在 `apps/edge` 里 import 一个最小 tsyringe 类（@injectable + constructor 注入），用 Vite+SWC 打包，
  `cf dev` 里 resolve 成功并返回字段。
- 验收：worker 内 `container.resolve(Foo)` 输出注入值；`cf deploy --dry-run` 报告 bundle 大小，`cf workers check` 报告 startup 时间。
- 失败处理：若 `emitDecoratorMetadata` 丢失 → 改用显式 `@inject(TOKEN)`（记录到 §7）。**这是唯一可能推翻 §2.1 的门禁。**

**T0.3 Binding 清单与本地环境**
- 动作：`cloudflare.config.ts` 的 `env` 写入 `ASSETS: bindings.assets()`、`DB: bindings.d1({name:'afilmory-db'})`、
  `PHOTOS: bindings.r2({name:'afilmory-photos'})`、`CACHE: bindings.kv({})`；`.dev.vars.example`；`drizzle.config.ts`（d1-http）。
- 验收：`cf dev --local` 能读到全部 binding；`cf d1 query <db> --local --command 'select 1'` 成功。

### Phase 1 — 只读画廊上线（可独立交付）

**T1.1 Web 构建产物**
- 动作：`pnpm --filter @afilmory/web build`（`AFILMORY_EMBED_MANIFEST=false`）；确认 `dist/index.html` 含
  `<script id="manifest">` 与 `<script id="config">` 空标签。
- 验收：`ls apps/web/dist/index.html` 且 grep 到两个占位标签。

**T1.2 静态托管 + SPA 回退**
- 动作：`assets.directory = ../web/dist`，`not_found_handling = single-page-application`，
  `run_worker_first = ["/", "/photos/*", "/og/*", "/share/*", "/api/*"]`。
- 验收：`curl /`、`/photos/xxx`（不存在时回落 index.html）、`/assets/*.js` 命中静态资源。

**T1.3 manifest / config 注入**
- 动作：manifest 存 R2（`manifest.json`），KV 缓存 60 s；`HTMLRewriter` 替换两个 script 内容；
  注入 `X-SSR: 1` 头。dev 模式回落到本地文件。
- 验收：`curl / | grep __MANIFEST__` 有数据；改 R2 object 后 ≤60 s 生效。

**T1.4 照片详情 meta**
- 动作：`/photos/:photoId` 读 manifest → 注入 title / og:* / twitter:*；不存在返回 404 + 原 shell。
- 验收：`curl /photos/<真实id> | grep og:image` 指向 `/og/<id>`。

**T1.5 OG 渲染**
- 动作：satori → SVG → `@resvg/resvg-wasm` → PNG(1200×630)；字体（Geist + PingFang 子集）放 R2，
  首次加载后 `caches.default` 缓存；`Cache-Control: public, max-age=86400`。
- 验收：`curl -o og.png /og/<id>` 得到 PNG；`file og.png` 显示 1200x630；连续 10 次请求内存无增长。
- 风险：中文字体导致内存超限 → 用字体子集（只保留常用字）并记录体积。

**T1.6 部署脚本 + 首次上线**
- 动作：`scripts/deploy-edge.sh`：build web → 上传 manifest/字体到 R2 → `cf deploy --provision`。
- 验收：`https://afilmory-edge.<subdomain>.workers.dev` 可访问画廊；OG 链接在社交预览里正确。
- 依赖：H2（首次 `--provision` 会自动建资源）。

### Phase 2 — 数据层（D1）

**T2.1 D1 schema 子集**
- 动作：新建 `be/packages/db/src/schema.sqlite.ts`（11 张表，§2.3）；`drizzle.config.sqlite.ts`；
  生成 `migrations-sqlite/0000_*.sql`。转换规则：enum→TEXT、jsonb→TEXT(json)、timestamp→INTEGER(epoch)、
  boolean→INTEGER、`defaultNow()`→`(unixepoch())`。
- 验收：`cf d1 migrations apply <db> --local` 成功；`cf d1 query <db> --local --command "select name from sqlite_master where type='table'"` 表数与 §2.3 一致。

**T2.2 D1 provider**
- 状态：**已完成（2026-10-19）**。
- 实现：
  - `be/apps/core/src/database/database.d1.provider.ts`：导出与 Node 版同名的
    `DbAccessor` / `DrizzleProvider` / `PgPoolProvider`，业务代码与 `DatabaseContextMiddleware` 不需要改 import。
    `PgPoolProvider` 保留 `getPool().connect().query()` 外形（`BEGIN`/`COMMIT`/`set_config` 为 no-op），
    使 health/middleware 代码原样运行。
  - `database.d1.module.ts` 提供上述三个 provider；`personal.module.ts` 改为从
    `@core/database/database.module` 导入。
  - `apps/edge/vite.config.ts` 增加别名（顺序敏感）：
    `@core/database/database.module` → D1 module、`@core/database/database.provider` → D1 provider、
    `@afilmory/db` → `schema.sqlite.ts`、`@core` → core `src`。
  - `db.execute()` 在 D1 provider 上适配成 `{ rows }`（内部走 `db.all()`）。
  - `schema.sqlite.ts` 的 `generateId` 改为基于 `Date.now()` + Web Crypto 的 64 位雪花；
    原 `nodejs-snowflake` 通过 WASM + `__dirname` 加载，在 workerd 中会直接抛
    `__dirname is not defined`（`cf dev` 启动即崩）。
  - 工具链：`@cloudflare/vite-plugin` 升到 `2.0.0-beta.v.1`（`cf` 1.0.0-beta.18 要求 v2 beta）。
- 验证：
  - `pnpm -C be/apps/core exec tsc --noEmit` → `CORE_OK`
  - `pnpm -C be/packages/db type-check` → `DB_OK`
  - `pnpm -C apps/edge exec tsc --noEmit` → 通过
  - `pnpm --filter @afilmory/edge build` → 289 modules，bundle 1.16 MB（gzip 328 KB）
  - `cf dev` → `curl :5173/api/health` 返回 tenant 行（见状态表）
  - 本地 D1 持久化在 `apps/edge/.cloudflare/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`；
    `cf d1 query --local` 尚未实现，迁移用 `sqlite3 <state-file> < migrations-sqlite/0000_heavy_skin.sql` 直接应用
    （应用后 `select count(*) from sqlite_master where type='table'` = 15）
- 已知缺口（不阻塞本任务验收）：
  - **完整 `PersonalModule` 尚未挂载进 Worker**：它依赖 `@afilmory/env`（要求 DATABASE_URL 等）和
    `RedisProvider`，属于 T3.1 的工作；当前 `/api/health` 用最小 `EdgeDatabaseModule` 验证 DI + D1。
  - `dashboard.service.ts` 的 analytics 仍是 PG 方言（`generate_series`、`jsonb_array_elements_text`、
    `#>>`），需要在 dashboard 阶段改写为 SQLite 表达；`.rows` 接口已兼容。
  - ~~事务仍是 no-op，写路径在 T2.3 完成前不具备原子性。~~ → 已由 T2.3 解决。
- 回退：Node 构建仍使用 `database.provider.ts`（PG），alias 只作用于 `apps/edge`。

**T2.3 事务改写**
- 状态：**已完成（2026-10-19）**。
- 动作：扫描个人版路径上的 `.transaction(`，实际命中 4 处（计划里预估的 comment/reaction 已不再使用事务）：
  `ManifestSyncService.recordDrafts`、`PhotoAssetService.deleteAssets`、
  `PhotoAssetService.uploadAssets`、`PhotoAssetService.updateAssetTags`。
- 实现：
  - 新增 `be/apps/core/src/database/atomic.ts`：`AtomicPlan`（语句列表 + 结果映射）与
    `AtomicBuilder`。`DbAccessor.runAtomically()` 在两个 provider 各自实现：
    PG 在 `db.transaction` 内顺序执行；D1 直接 `db.batch(statements)`。
    约束：计划只能在 `resolve()` 里读结果，不能在构造后续语句时依赖前一条语句的结果。
  - `ManifestSyncService.createDraftPlan()` 不再 `select ... for update`：
    1. `insert tenant_manifest_state ... on conflict do nothing`
    2. `update tenant_manifest_state set revision = revision + N ... returning revision`
    3. N 条 `insert tenant_manifest_change`，revision 用
       `(select revision from tenant_manifest_state where tenant_id = ?) - 偏移`
    4. `delete ... where revision <= 当前 revision - 10000`
    以上语句在同一个 PG 事务或同一个 D1 batch 内执行；并发写入靠 `UPDATE` 行锁/串行化，
    不再需要显式 `for update`。
  - `PhotoAssetService.deleteAssets` 把 `delete photo_asset` 与 draft plan 合并成一个 atomic plan。
  - 上传与标签更新需要读取 upsert/update 返回的行来生成 change payload，而 D1 的 batch 不能
    中途读结果，因此拆成「单条 `INSERT ... ON CONFLICT DO UPDATE RETURNING` / `UPDATE RETURNING`」
    + `recordDrafts()` 幂等批次。刻意接受两步之间极小窗口的最终一致（变更可重放/幂等），
    没有引入 Durable Object。
  - 回归测试：
    - `manifest-sync.service.spec.ts`：连续调用 revision 连续（1,2 → 3）；两个数据库连接并发写入
      revision 仍为 `[1,2]` 无重复；超过保留窗口的旧 change 被剪枝。
    - `photo-asset.service.spec.ts`：删除资源与写 manifest change 原子完成；重复删除同一资源
      返回 `[]` 且不新增 change 行。
    - 测试用 `node:sqlite` + `drizzle-orm/sqlite-proxy` 的 batch 回调模拟 D1 的 batch 语义，
      schema 直接执行 `migrations-sqlite/0000_heavy_skin.sql`。
- 验证：
  - `pnpm -C be/apps/core exec vitest run src/modules/content/manifest-sync/manifest-sync.service.spec.ts src/modules/content/photo/assets/photo-asset.service.spec.ts`
    → 2 files / 5 tests passed
  - `pnpm -C be/apps/core exec tsc --noEmit`、`pnpm -C apps/edge exec tsc --noEmit` → 通过
  - `pnpm --filter @afilmory/edge build` → 284 modules，bundle 1.16 MB（gzip 328 KB）
  - `cf dev` → `curl :5173/api/health` 仍返回 `status: ok`
  - 全量 core vitest：84 tests passed；另有 6 个既有 spec 因仓库缺少 `be/.env`
    （`be/apps/core/.env` 是断链符号链接）在 import 阶段报 `Invalid environment variables`，
    与本次改动无关。
- 回退：若某处 batch 语义不成立，可把该调用单独切回 `for update` + 串行化，不影响其他路径。

**T2.4 数据迁移/初始化脚本**
- 动作：`scripts/migrate-pg-to-d1.ts`：读 PG（Hyperdrive 或本地连接）→ 转换 → `batch()` 写 D1；
  幂等（按主键 upsert）。无历史数据时只 seed 单行 tenant + 管理员。
- 验收：行数对账一致；抽样 10 行 JSON 字段 diff 为空。

**T2.5 租户 shim**
- 动作：`TenantResolverInterceptor` 个人版实现：永远返回固定 tenant；启动时确保该行存在。
- 验收：`requireTenantContext()` 在任意请求内可用；访问不存在租户的路径不会发生。

### Phase 3 — 认证与后台

**T3.1 better-auth + D1**
- 动作：auth 的 drizzle adapter 指向 sqlite schema；session cookie 域配置；
  关闭社交登录 / 邮件验证（个人版不需要）。
- 验收：`/api/auth/session` 未登录返回 null；登录后返回 user。

**T3.2 单管理员引导**
- 动作：首次部署用 CLI/一次性脚本创建管理员；关闭注册（或保留但仅允许已存在邮箱）。
- 验收：`cf d1 query <db> --command 'select id,email from auth_user'` 能看到 1 条；注册接口返回 403。

**T3.3 dashboard 托管（与画廊同一个 Worker，不单独部署）**
- 动作：`apps/edge/scripts/sync-assets.sh` 把 `apps/web/dist` 与 `be/apps/dashboard/dist` 合并到 `apps/edge/public/`
  （根目录 = 画廊，`/dashboard/` = 后台）；Worker 对 `/dashboard/*` 回退到 `/dashboard/index.html`；API 同源。
- 验收：浏览器打开 `/dashboard` 能登录并看到画廊列表。

### Phase 4 — 上传（核心，功能对等）

**T4.1 上传意图接口**
- 动作：`POST /api/photos/upload-intent`，body: `{ filename, size, contentType, directory? }`。
  返回 `{ mode: 'single'|'multipart', url|uploadId+parts, key, headers }`。R2 用 `aws4fetch` 签名。
- 验收：`curl` 拿到预签名 URL；用 `curl -X PUT --data-binary @photo.jpg <url>` 成功写入 R2。

**T4.2 完成回调 + 去重**
- 动作：`POST /api/photos/upload-complete`：HEAD 校验对象、取 size/etag、查 `photo_asset` 唯一键去重，
  写 `pending` 记录，返回 assetId。
- 验收：重复调用返回同一 asset（幂等）；同 key 不产生两行。

**T4.3 元数据提取**
- 动作：R2 range 读前 256 KB → `exifr` 解析 EXIF/XMP/GPS；宽高用 `Image` 头解析或由客户端传；
  `thumbhash` 由客户端在 form 字段传入（iOS 已有 `Core/ThumbHash.swift`，Web 用 canvas）。
- 验收：拿 3 张真实照片（含 iPhone HEIC、单反 JPEG、带 GPS 的）对比 exiftool 输出，字段差异清单写入 PR 描述。
- 风险：中。RAW/冷门标签可能缺失 → 记录，不阻塞上线。

**T4.4 缩略图 URL**
- 动作：生成 `/cdn-cgi/image/width=<w>,format=auto,quality=<q>/<r2-custom-domain>/<key>`；
  manifest 写入 `thumbnailUrl`/`originalUrl`，保持字段名不变。
- 验收：浏览器打开缩略图返回 WebP/AVIF；HEIC 原图可出图。
- 若 H4 选 wasm：改为任务 T4.4b（`@jsquash/*` + 降采样），验收同上 + 内存 <100 MB。

**T4.5 manifest 增量更新**
- 动作：上传完成后更新 `photo_asset` + `tenant_manifest_change` → 重建 manifest（个人量级可全量重建）→
  写 R2 → 失效 KV。保持 `ManifestSyncService.emitChanged` 的对外语义（改为进程内事件）。
- 验收：上传后 ≤5 s，`/api/manifest` 与画廊首页出现新照片。

**T4.6 Live Photo 配对**
- 动作：同 base name 的 HEIC + MOV 作为一组写入；manifest 字段与现在一致。
- 验收：上传一组 Live Photo，详情页能播放视频。

### Phase 5 — 保留的互动与输出

**T5.1 评论 / 反应**：保留现有 controller/service，跑在 D1 上；验收：发评论 → 刷新可见；反应计数正确。
**T5.2 feed / sitemap / well-known**：现有路由原样挂载；验收：`/feed.xml`、`/sitemap.xml` 返回 200 且 XML 合法。
**T5.3 分享页 / embed**：`/share/iframe`、`/share/embed.js` 用 Worker 渲染（React SSR 或模板字符串）；验收：iframe 可嵌入。

### Phase 6 — iOS 兼容

**T6.1 契约核对**
- 动作：对照 `apps/mobile/Afilmory/Core/Networking/APIEndpoint.swift` 逐个端点核对路径/方法/字段；
  产出差异表（缺哪个补哪个）。
- 验收：`Afilmory Local` 指向新 Worker（本地或 preview）能登录、看 feed、评论。

**T6.2 上传兼容**
- 动作：若 iOS 仍走 multipart → Worker 提供一条 ≤100 MB 的兼容通道；否则改 iOS 走预签名。
- 验收：真机/模拟器上传 1 张成功并在网页端可见。

### Phase 7 — 运维与收尾

**T7.1 Cron**：`triggers.scheduled("0 * * * *")`；清理临时上传、预热 OG 缓存；验收：`cf workers deployments list` + 日志确认 cron 执行。
**T7.2 可观测**：`observability.enabled`、结构化日志、`/api/health` 含 D1/R2 探活。
**T7.3 备份**：D1 `export` → R2，Cron 每日；验收：能从备份恢复到本地 D1。
**T7.4 下线旧栈**：删除 `apps/ssr`、`Dockerfile*` 中的 Next 相关步骤、更新 `AGENTS.md`/`README`；
验收：`pnpm build` 不再依赖 Next。

---

## 6. Definition of Done

- [ ] 公网域名打开画廊，图片、地图、详情、OG 全部正常
- [ ] 登录 dashboard，上传 1 张 HEIC + 1 张 JPEG + 1 组 Live Photo，画廊 5 s 内出现
- [ ] 上传 1 个 >100 MB 的文件（走 multipart）成功
- [ ] 评论、反应、feed、sitemap、分享 iframe 可用
- [ ] iOS Local 变体连通：登录、浏览、上传、评论
- [ ] `pnpm type-check`、`pnpm lint`、`pnpm --filter core test` 通过
- [ ] 冷启动 < 1 s（`cf workers check` 的 startup 证据）
- [ ] 备份可恢复；`cf workers versions` 回滚演练过一次

---

## 7. 已知风险与回退

| 风险 | 触发条件 | 回退 |
| --- | --- | --- |
| 装饰器元数据在 Worker 构建中丢失 | T0.2 失败 | 显式 `@inject(TOKEN)`；或该模块留 Node（不推荐） |
| D1 无法表达某处事务 | T2.3 | DO 串行化；或该接口降级为「最终一致 + 幂等」 |
| EXIF 字段缺失 | T4.3 | 保留 `exiftool` 作为一次性离线补数据脚本，不阻塞线上 |
| 中文字体撑爆 128 MB | T1.5 | 字体子集 + 只缓存渲染结果 |
| Images 变换不满足画质 | T4.4 | 切 T4.4b（wasm）或容器（最后手段） |
| 大文件上传失败 | T4.1 | 检查 multipart 分片大小与 R2 限制；保留单文件 PUT 兜底 |

---

## 8. Agent 汇报格式

每完成一个任务，在 PR/提交说明里写：

```
T4.2 done
- 改动: <files>
- 验证: <命令> → <输出摘要>
- 未覆盖: <已知缺口>
- 下一步: T4.3
```

遇到阻塞（缺凭据 / 失败无法绕过）时：**先推进不依赖它的任务**，并在最终汇报里集中列出
`blocked: T1.6 (H1)` 这样的清单，不要逐个任务停下来问。
