<p align="center">
  <img src="https://github.com/Afilmory/assets/blob/main/afilmory-readme-2:1.webp?raw=true" alt="Afilmory Edge" width="100%" />
</p>

# <p align="center">Afilmory Edge</p>

<p align="center">
  <em>A personal, Cloudflare-native photo gallery derived from Afilmory</em>
</p>

<p align="center">
  <a href="./docs/README.md">Documentation</a> •
  <a href="./ORIGIN.md">Origin & Differences</a> •
  <a href="#-quick-start">Quick Start</a>
</p>

---

**Afilmory Edge** is a personal photo gallery deployment that runs as one Cloudflare Worker.
It keeps the name **Afilmory** — **Auto Focus (AF)**, **Aperture** (light control), **Film** (vintage medium), and **Memory** (captured moments) — and adds **Edge** for its Cloudflare-native deployment.
The Worker serves the gallery SPA, the admin dashboard, and the API from the same origin, backed by D1, KV, and object storage: Cloudflare R2 for the one-click deployment, or any S3-compatible bucket (such as Aliyun OSS) for a self-managed setup.

This project is maintained independently from [Afilmory](https://github.com/Afilmory/Afilmory) and has been stripped down for personal use. See [ORIGIN.md](./ORIGIN.md) for what changed.

> **Unofficial derivative.** Afilmory Edge is not affiliated with, sponsored by, or endorsed by the Afilmory team. "Afilmory" is used only to describe the origin of this code; the name and marks belong to their respective owners.

## 🚀 Quick Start

### Option A: One-click on Cloudflare (R2)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/liyown/afilmory-edge)

The button copies this repository into your GitHub account, builds the Worker, provisions **D1, KV, and R2** from `wrangler.jsonc`, applies the D1 migrations, and deploys. It prompts for three secrets:

| Secret                  | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `CONFIG_ENCRYPTION_KEY` | Encrypts settings stored in D1. Generate one with `openssl rand -base64 32` |
| `BETTER_AUTH_SECRET`    | Signs auth sessions. Falls back to `CONFIG_ENCRYPTION_KEY` when omitted |
| `SETUP_TOKEN`           | One-time token used to claim the owner account                          |

After the deployment finishes, open `https://<your-worker>.workers.dev/platform/login`. Because the database is empty, the login page asks for the setup token: enter the `SETUP_TOKEN` you chose, then your email and password. That creates the single owner account, and the dashboard takes over from there.

Photos, thumbnails, Live Photo videos, `manifest.json`, the OG cache, and D1 backups all live in the provisioned R2 bucket. Uploads go through the Worker (multipart for files above 80 MiB), so you never need R2 credentials.

### Option B: Manual deployment with Aliyun OSS

```bash
# 1. Clone and install
git clone https://github.com/liyown/afilmory-edge.git
cd afilmory-edge
pnpm install

# 2. Configure
cp config.example.json config.json
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
# Edit config.json and apps/edge/.dev.vars.

# 3. Create the Cloudflare resources and apply the baseline migration
cf d1 create --name afilmory-db
# Create a private OSS bucket in the Aliyun console and note its region
cf d1 migrations apply <database-id> --dir be/packages/db/migrations

# 4. Build and deploy
pnpm build
pnpm deploy:edge

# 5. Create the owner account (or use SETUP_TOKEN in the dashboard instead)
pnpm bootstrap:admin --email you@example.com \
  --account-id <account-id> --database-id <database-id> --api-token <api-token>
```

Sign in at `/platform/` and upload photos from the dashboard.
See [Deployment](./docs/deployment.md) for binding setup, secrets, and backups.

### Sync a local folder

The `afi` CLI watches a folder and uploads new photos automatically:

```bash
curl -fsSL https://raw.githubusercontent.com/liyown/afilmory-edge/main/scripts/install-afi.sh | sh
```

On Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/liyown/afilmory-edge/main/scripts/install-afi.ps1 | iex
```

Then:

```bash
afi login
cd ~/Pictures/import
afi add
afi ls
```

It uses browser OAuth, stores only a revocable long-lived token, and watches filesystem events
without polling. See [apps/sync/README.md](./apps/sync/README.md) for details.

## 📸 Live Gallery

- [photos.liuyaowen.cn](https://photos.liuyaowen.cn) - This deployment

For galleries running the upstream project, see [Afilmory](https://github.com/Afilmory/Afilmory#-live-galleries).

## ✨ What Afilmory Edge adds

The gallery UI, WebGPU/WebGL viewer, masonry layout, EXIF display, maps, comments, and i18n come from upstream [Afilmory](https://github.com/Afilmory/Afilmory) and are kept intact. This repository focuses on the deployment layer and adds:

- ☁️ **One Worker, one origin** - The gallery SPA, dashboard, API, OG images, sitemap, RSS feed, and share embeds are all served by the same Worker.
- 👤 **Personal deployment** - One owner account, registration closed, no platform or multi-user surface to configure.
- 🪣 **R2 or S3 storage** - The one-click deployment uses the native R2 binding with Worker-proxied multipart uploads; the manual path uses direct presigned multipart uploads to Aliyun OSS over the S3 API. Both support range reads for EXIF/motion data and a private `/media/*` proxy.
- 🔐 **First-run owner setup** - A `SETUP_TOKEN` lets you create the owner account from the dashboard, with no CLI bootstrap or Cloudflare API token.
- 🗄️ **D1 + KV only** - D1 for relational data and runtime settings, KV for hot caches; no PostgreSQL or Redis.
- ⚙️ **D1-backed site settings** - Name, title, author, avatar, social links, and map options are edited in the dashboard and injected into every page shell.
- 🧾 **Built-in backups** - A daily cron exports D1 into the same private bucket (14 rotating copies) with a restore script.
- 🧱 **Fresh baseline** - A single D1 baseline migration with no legacy history or compatibility shims.
- 🚀 **Single build and deploy** - `pnpm build` assembles both SPAs and the Worker; `pnpm deploy:edge` ships it.
- **Local folder sync** - A Rust `afi` CLI watches camera/import folders and uploads through the same API, with browser OAuth and a revocable token.
- **AI semantic search** - Uploads are captioned and tagged with Workers AI; Vectorize powers natural-language search in the gallery header. See [AI photo search](./docs/ai-photo-search.md).

## 🏗️ Architecture

### Monorepo Structure

```
afilmory-edge/
├── apps/
│   ├── web/              # Gallery SPA (Vite + React 19 + React Router 7)
│   ├── edge/             # Cloudflare Worker: SPA + dashboard, core API, OG/SEO, cron
│   ├── docs/             # Documentation site (Vite + MDX)
│   └── promo/            # Promo videos (Remotion)
├── be/                   # Backend services
│   ├── apps/
│   │   ├── core/         # Core API server (Hono + @tsuki-hono)
│   │   ├── dashboard/    # Admin dashboard SPA
│   │   └── oauth-gateway/# Standalone OAuth broker
│   └── packages/
│       ├── db/           # D1 schema & migrations (Drizzle ORM)
│       ├── env/          # Worker binding access
│       └── utils/        # Shared backend utilities
├── packages/
│   ├── data/             # PhotoLoader over the injected manifest
│   ├── webgl-viewer/     # GPU image viewer (WebGPU + WebGL fallback)
│   ├── viewer-motion/    # Framework-agnostic viewer motion primitives
│   ├── renderer/         # OG image renderer (Satori + resvg)
│   ├── typing/           # Shared photo/manifest types
│   ├── sdk/              # Public SDK + share embed script
│   ├── ui/               # Shared UI components
│   ├── hooks/            # React hooks library
│   └── utils/            # Utility functions
└── plugins/              # ESLint / Vite tooling plugins
```

### Frontend Stack

- **React 19** - With the React Compiler
- **TypeScript 6** - Full type safety
- **Vite 8** - Lightning-fast build tool
- **React Router 7** - File-based routing
- **Tailwind CSS 4** - Utility-first CSS with the Apple UIKit color palette
- **Radix UI / Headless UI** - Accessible component primitives
- **Motion** - Spring-based animations
- **Jotai** - Atomic state management
- **TanStack Query** - Data fetching and caching
- **MapLibre GL** - Interactive maps
- **i18next** - Internationalization

### Image Viewer

- **WebGPU** - Primary renderer, with worker-side texture decoding and tiled uploads
- **WebGL** - Automatic fallback for browsers without WebGPU
- **HDR Gain Maps** - JPEG gain-map parsing and HDR compositing on `dynamic-range: high` displays

### Edge Host

- **Cloudflare Workers** - Serves the SPA, injects the manifest from object storage, renders dynamic OG images/SEO metadata, and runs scheduled backup/cleanup
- **D1 + object storage + KV** - D1 for relational data, R2 or an S3-compatible bucket for photos/manifest/OG cache/backups, KV for hot caches

### Backend Stack

- **Hono** - Ultra-fast web framework
- **@tsuki-hono** - NestJS-style modules, controllers, and decorators on top of Hono, with `tsyringe` DI
- **Drizzle ORM** - Type-safe database toolkit over D1
- **D1** - Relational database (SQLite)
- **KV** - Cache and manifest revision storage
- **R2 / Aliyun OSS** - Photo objects, manifest and backup storage through the native R2 binding or the S3 API
- **Better Auth** - Authentication with the Drizzle SQLite adapter
- **In-process events** - SSE progress for sync/upload jobs
- **workers-og** - Dynamic OG image rendering

### Upload Pipeline

- **Dashboard** - Batches up to 128 files, renders thumbnails and ThumbHash placeholders in the browser
- **R2 / Aliyun OSS** - Worker-proxied uploads through the R2 binding, or direct presigned uploads over the S3 API
- **exifr** - Metadata extraction through bounded range reads
- **heic-to** - Browser-side HEIC/HEIF decoding for previews and thumbnails

## 🛠️ Development

### Prerequisites

- Node.js (current LTS)
- pnpm 12+
- The `cf` CLI

### Project Setup

```bash
pnpm install
cp config.example.json config.json
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
```

### Common Commands

```bash
# Development
pnpm dev                    # Cloudflare Worker + web app (cf dev)
pnpm dev:edge               # Cloudflare Worker only
pnpm --filter @afilmory/dashboard dev  # Admin dashboard

# Data & deployment
pnpm bootstrap:admin        # Create the owner account in D1 (CLI fallback)
pnpm restore:d1-backup      # Restore D1 from an object-storage backup
pnpm deploy                 # Apply D1 migrations and deploy with Wrangler (R2 config)
pnpm deploy:edge            # Deploy the Worker through the cf CLI (OSS config)

# Build
pnpm build                  # Build web + dashboard + Cloudflare Worker

# Documentation
pnpm docs:dev               # Start docs dev server
pnpm docs:build             # Build documentation

# Code Quality
pnpm lint                   # Lint and fix
pnpm format                 # Format code
pnpm type-check             # Type checking
```

### Configuration

Configuration lives in three layers:

| Layer                 | Location                                                                  | Purpose                                                                 |
| --------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Presentation defaults | `config.json`                                                             | Fallback site identity used before anything is saved from the dashboard |
| Runtime site settings | D1 (`site.*`)                                                             | Authoritative site identity, edited at `/platform/settings`             |
| Worker secrets        | `.dev.vars` (local) or `wrangler secret put` (production)                 | Encryption keys, setup token, and optional S3 credentials               |

The one-click path uses the bindings in the root `wrangler.jsonc`; the OSS path declares them in `apps/edge/cloudflare.config.ts`:

| Binding  | Service            | Purpose                                             |
| -------- | ------------------ | --------------------------------------------------- |
| `DB`     | D1 (`afilmory-db`) | Users, photo assets, comments, settings, sync state |
| `CACHE`  | KV                 | Manifest revisions and hot caches                   |
| `ASSETS` | Workers Assets     | Built gallery and dashboard files                   |
| `PHOTOS` | R2 (`afilmory-photos`) | Photos, manifest, OG cache, and backups (R2 only) |

#### Presentation defaults (`config.json`)

```json
{
  "name": "My Gallery",
  "title": "My Photography",
  "description": "Capturing beautiful moments",
  "url": "https://gallery.example.com",
  "accentColor": "#007bff",
  "author": {
    "name": "Your Name",
    "url": "https://example.com",
    "avatar": "https://example.com/avatar.jpg"
  },
  "social": {
    "github": "username",
    "twitter": "username"
  },
  "map": ["maplibre"],
  "mapStyle": "builtin",
  "mapProjection": "mercator"
}
```

`config.json` is baked into the build. Once you save site settings from the dashboard they are stored in D1 and injected into every shell response, overriding these defaults.

#### Worker secrets

| Secret                  | Required          | Purpose                                                     |
| ----------------------- | ----------------- | ----------------------------------------------------------- |
| `CONFIG_ENCRYPTION_KEY` | Yes               | Encrypts sensitive settings stored in D1                    |
| `BETTER_AUTH_SECRET`    | No                | Signs auth sessions; falls back to `CONFIG_ENCRYPTION_KEY`  |
| `SETUP_TOKEN`           | For first-run setup | Gates creating the owner account from the login page      |
| `STORAGE_DRIVER`        | No                | `r2` uses the `PHOTOS` binding; `s3` (default) uses the secrets below |
| `S3_ENDPOINT`           | With `s3` driver  | Virtual-hosted bucket URL (bucket name is part of the host) |
| `S3_REGION`             | With `s3` driver  | OSS region, e.g. `cn-shenzhen`                              |
| `S3_ACCESS_KEY_ID`      | With `s3` driver  | Access key with read/write access to the bucket             |
| `S3_SECRET_ACCESS_KEY`  | With `s3` driver  | Matching secret key                                         |

The R2 driver is selected automatically when the `PHOTOS` binding exists; set `STORAGE_DRIVER=r2` only when you want to force it (for example, against a simulation).

For the `s3` driver, object storage uses the S3-compatible API of Aliyun OSS. The endpoint must include the bucket:

```bash
S3_ENDPOINT=https://my-gallery.s3.oss-cn-shenzhen.aliyuncs.com
S3_REGION=cn-shenzhen
S3_ACCESS_KEY_ID=<access-key-id>
S3_SECRET_ACCESS_KEY=<access-key-secret>
```

Keep the bucket private. With the `s3` driver the Worker hands the browser presigned multipart upload URLs; with the `r2` driver uploads are proxied through the Worker instead. Both drivers read originals through range requests and serve media through the `/media/*` proxy. One bucket holds:

- `photos/` - originals, thumbnails, and Live Photo/Motion Photo videos
- `manifest.json` - the rendered gallery manifest
- `og/` - cached OpenGraph images
- `backups/d1/` - daily D1 exports, unreachable over HTTP

Set production secrets interactively (the CLI prompts for the value):

```bash
cf workers secrets update CONFIG_ENCRYPTION_KEY --type secret_text --worker afilmory-edge
cf workers secrets update S3_ENDPOINT --type secret_text --worker afilmory-edge
# ...repeat for S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
```

The root `wrangler.jsonc` deployments use `wrangler secret put <NAME>` instead.

For local development, copy `apps/edge/.dev.vars.example` to `apps/edge/.dev.vars` and fill in the same values. Use `STORAGE_DRIVER=r2 pnpm dev` to exercise the R2 driver against the local simulation.

## 📚 Documentation

- **[Architecture](./docs/architecture.md)** - Worker, D1, OSS, and KV design
- **[Deployment](./docs/deployment.md)** - Provision Cloudflare resources and deploy
- **[Configuration](./docs/configuration.md)** - Worker secrets and runtime settings
- **[Backend](./be/README.md)** - API graph, database access, and testing

## 🤝 Contributing

We welcome contributions!
See [AGENTS.md](./AGENTS.md) for architecture notes and [DESIGN.md](./DESIGN.md) for the web design system.

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run linting and type checks (`pnpm lint && pnpm type-check`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 📄 License

Attribution Network License (ANL) v1.0 © 2025 Afilmory Team

Afilmory Edge is a derivative of Afilmory. See [LICENSE](./LICENSE) and [ORIGIN.md](./ORIGIN.md) for attribution and scope.

## 🔗 Links

- **[Documentation](./docs/README.md)** - Full documentation
- **[Origin & Differences](./ORIGIN.md)** - How this project relates to upstream Afilmory
- **[Credits](./CREDITS.md)** - Upstream authors and attribution
- **[Afilmory Edge](https://github.com/liyown/afilmory-edge)** - This repository
- **[Afilmory](https://github.com/Afilmory/Afilmory)** - Upstream project

## 🙏 Acknowledgments

Afilmory Edge is built on the work of the [Afilmory](https://github.com/Afilmory/Afilmory) team and its contributors. See [CREDITS.md](./CREDITS.md) for the full list.
Special thanks to all photographers using Afilmory to share their work with the world.

---

<p align="center">
  If this project helps you, please give it a ⭐️ Star!
</p>
