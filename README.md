<p align="center">
  <img src="https://github.com/Afilmory/assets/blob/main/afilmory-readme-2:1.webp?raw=true" alt="Afilmory" width="100%" />
</p>

# <p align="center">Afilmory</p>

<p align="center">
  <em>A modern, high-performance photo gallery for photographers</em>
</p>

<p align="center">
  <a href="./docs/README.md">Documentation</a> •
  <a href="#-live-galleries">Live Examples</a> •
  <a href="#-quick-start">Quick Start</a>
</p>

---

**Afilmory** (/əˈfɪlməri/, "uh-FIL-muh-ree") is a personal, single-tenant photo gallery that deploys as one Cloudflare Worker.
It combines **Auto Focus (AF)**, **Aperture** (light control), **Film** (vintage medium), and **Memory** (captured moments).
The Worker serves the gallery SPA, the admin dashboard, and the API from the same origin, backed by D1, R2, and KV.

## 🚀 Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Afilmory/Afilmory.git
cd Afilmory
pnpm install

# 2. Configure
cp config.example.json config.json
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
# Edit config.json and apps/edge/.dev.vars.

# 3. Create the Cloudflare resources and apply the baseline migration
cf d1 create afilmory-db
cf r2 bucket create afilmory-photos
cf kv namespace create AFILMORY_CACHE
cf d1 migrations apply afilmory-db --remote

# 4. Build and deploy
pnpm build
pnpm deploy:edge

# 5. Create the owner account
pnpm bootstrap:admin --email you@example.com \
  --account-id <account-id> --database-id <database-id> --api-token <api-token>
```

Sign in at `/platform/` and upload photos from the dashboard.
See [Deployment](./docs/deployment.md) for binding setup, secrets, and backups.

## 📸 Live Galleries

See Afilmory in action:

- [afilmory.innei.in](https://afilmory.innei.in) - Creator's personal gallery
- [gallery.mxte.cc](https://gallery.mxte.cc)
- [photography.pseudoyu.com](https://photography.pseudoyu.com)
- [afilmory.magren.cc](https://afilmory.magren.cc)

## ✨ Features

### Core Capabilities

- 🖼️ **WebGPU Image Viewer** - Custom GPU viewer that renders through WebGPU by default and falls back to WebGL when `navigator.gpu` is unavailable; smooth zoom, pan, pinch, and double-tap cycling between fit, fill, and 100%
- 🧩 **Tiled Rendering** - Large photos are decoded off the main thread in a worker and streamed to the GPU as tiles
- 📱 **Responsive Masonry Layout** - Powered by Masonic, adapts seamlessly to any screen size
- 🎨 **Modern UI/UX** - Tailwind CSS 4 with the Apple UIKit color palette, glass materials, and spring motion
- 🌐 **Internationalization** - English, 简体中文, 繁體中文 (HK/TW), 日本語, and 한국어
- 🔗 **Social Sharing** - Dynamic OpenGraph images, per-photo metadata, sitemap, RSS feed, and embed script

### Upload and Processing

- 🖼️ **Dashboard Uploads** - Drag and drop batches of photos; HEIC/HEIF files are converted in the browser for previews and thumbnails
- 🧵 **Generated Thumbnails** - A 600px JPEG is rendered client-side and stored beside the original in R2
- 📊 **Complete EXIF Display** - Camera, lens, focal length, aperture, ISO, GPS, timezone, white-balance shifts, and more (via `exifr` range reads)
- 🌈 **ThumbHash Placeholders** - Compact placeholders for a smooth progressive loading experience
- 📱 **Live Photos** - Pair an iPhone `.MOV` companion with its image; the dashboard matches them by base name
- 🎬 **Motion Photos** - Android motion photos are detected from EXIF and extracted with R2 range requests
- ☀️ **HDR Gain Maps** - Renders JPEG gain-map HDR (including Apple HDR photos) on HDR-capable displays
- 🗺️ **Interactive Map** - Geographic visualization with GPS coordinates using MapLibre
- 💬 **Comments & Reactions** - Visitor engagement backed by D1
- 📷 **Share & Embed** - Share images to social media or embed them via the SDK

## 🏗️ Architecture

### Monorepo Structure

```
afilmory/
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

- **Cloudflare Workers** - Serves the SPA, injects the manifest from R2, renders dynamic OG images/SEO metadata, and runs scheduled backup/cleanup
- **D1 + R2 + KV** - D1 for relational data, R2 for photos/manifest/OG cache/backups, KV for hot caches

### Backend Stack

- **Hono** - Ultra-fast web framework
- **@tsuki-hono** - NestJS-style modules, controllers, and decorators on top of Hono, with `tsyringe` DI
- **Drizzle ORM** - Type-safe database toolkit over D1
- **D1** - Relational database (SQLite)
- **KV** - Cache and manifest revision storage
- **R2** - Photo objects, manifest and backup storage
- **Better Auth** - Authentication with the Drizzle SQLite adapter
- **In-process events** - SSE progress for sync/upload jobs
- **workers-og** - Dynamic OG image rendering

### Upload Pipeline

- **Dashboard** - Batches up to 128 files, renders thumbnails and ThumbHash placeholders in the browser
- **R2** - Presigned uploads when S3 credentials are configured, otherwise a Worker proxy
- **exifr** - Metadata extraction through bounded R2 range reads
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
pnpm bootstrap:admin        # Create the owner account in D1
pnpm restore:d1-backup      # Restore D1 from an R2 backup
pnpm deploy:edge            # Deploy the Worker

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

### Configuration Files

**`config.json`** - Build-time presentation defaults:

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

Site settings stored in D1 are authoritative at runtime: the Worker injects them into every page shell, and the owner edits them from the dashboard. `config.json` only supplies the defaults used when a setting has not been saved yet.

**`apps/edge/.dev.vars`** - Local Worker secrets (see `.dev.vars.example`).
Production values are set with `cf secret put`.

## 📚 Documentation

- **[Architecture](./docs/architecture.md)** - Worker, D1, R2, and KV design
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

See [LICENSE](./LICENSE) for more details.

## 🔗 Links

- **[Documentation](./docs/README.md)** - Full documentation
- **[GitHub](https://github.com/Afilmory/Afilmory)** - Source code
- **[Creator's Website](https://innei.in)** - Project creator

## 🙏 Acknowledgments

Built with love by the Afilmory team and contributors.
Special thanks to all photographers using Afilmory to share their work with the world.

---

<p align="center">
  If this project helps you, please give it a ⭐️ Star!
</p>
