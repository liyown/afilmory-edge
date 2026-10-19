# Development Guide

This document is for contributors and self-hosters who want to customize or run Afilmory from source.

## Workspace Layout

- `apps/web`: Gallery SPA.
  Reads the manifest injected by the Worker as `window.__MANIFEST__`.
- `apps/edge`: Cloudflare Worker.
  Serves the SPA and dashboard, mounts the core API, injects runtime config/manifest, renders OG/SEO responses, and runs scheduled maintenance.
- `be/apps/core`: Hono API graph (`@tsuki-hono` modules, tsyringe DI) that runs inside the Worker.
- `be/apps/dashboard`: Owner-facing admin SPA served under `/platform/`.
- `packages/data`: `PhotoLoader`, which wraps the injected manifest into lookup maps.
- `packages/typing`: Shared photo, EXIF, and manifest types used by the SPA, dashboard, Worker, and tests.
- `config.json` + `site.config.ts`: Build-time presentation defaults.
- D1 `site.*` settings: Runtime presentation values injected by the Worker.
  The dashboard edits these.

## Quick Start (from source)

1. Install dependencies

```bash
pnpm install
```

2. Copy configs and fill values

```bash
cp config.example.json config.json
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
```

3. Create local Cloudflare resources

`cf dev` provisions local D1, R2, and KV automatically.
To apply the schema manually:

```bash
cf d1 migrations apply afilmory-db --local
```

4. Run the app

```bash
pnpm dev              # Worker + SPA + dashboard on :5173
pnpm dev:edge         # Worker only
```

Uploads, metadata extraction, thumbnail storage, and manifest publication all run through the Worker during development; there is no separate photo pipeline.

## How Photos Flow

1. The dashboard requests an upload intent, then uploads the original to R2 (presigned or proxied through the Worker).
2. The dashboard renders a 600px JPEG thumbnail, a ThumbHash placeholder, and a tone analysis in the browser, then posts them to `upload-complete`.
3. The Worker verifies the object size, extracts EXIF/XMP with bounded R2 range reads, detects Live Photos and Motion Photos, and inserts a `photo_asset` row in D1.
4. `ManifestPublisher` rebuilds `manifest.json` in R2 from D1 and clears the KV cache.
5. The next shell request injects the new manifest; feed, sitemap, and share routes read D1 directly.

## Site Presentation Config (`config.json`)

`config.json` merges into `site.config.ts` for the SPA:

- `name` / `title` / `description` / `url` / `accentColor`
- `author`: `{ name, url, avatar }`
- `social`: `{ github?, twitter? }`
- `feed`: supports `folo.challenge.feedId` and `userId`
- `map`: map providers, e.g. `["maplibre"]`
- `mapStyle`: `builtin` or provider-specific style
- `mapProjection`: `globe` or `mercator`

Values saved through the dashboard (`site.*` keys in D1) take precedence at runtime.

## Common Commands

```bash
# Lint and format
pnpm lint
pnpm format

# Type check
pnpm type-check
pnpm --filter web type-check

# Tests (per package)
pnpm --filter core test
pnpm --filter @afilmory/viewer-motion test

# Build production
pnpm build
```

## Database

The Drizzle schema lives in `be/packages/db/src/schema.ts`; migrations are generated into `be/packages/db/migrations`:

```bash
pnpm -C be/packages/db db:generate
```

The repository ships a single baseline migration and targets fresh databases.
