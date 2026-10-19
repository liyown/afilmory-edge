# Architecture Overview

Afilmory is a single-tenant gallery deployment. One owner account manages one gallery on a single domain.

- **apps/web**: React 19 + Vite SPA. Consumes `photos-manifest.json` and thumbnails.
- **apps/edge**: Cloudflare Worker. Serves the gallery SPA and dashboard, mounts the core API under `/api`, renders OG/SEO responses, streams dynamic sitemap/feed routes and runs scheduled backup/cleanup.
- **be/apps/core**: Hono API with `@tsuki-hono` modules and tsyringe DI. Runs inside the Worker.
- **be/apps/dashboard**: Admin SPA for the owner. Uploads photos, edits site settings, manages comments and reactions.
- **be/apps/oauth-gateway**: Standalone OAuth callback broker used only when social login is configured.
- **packages/builder**: Photo pipeline. Syncs from storage (S3-compatible/local), processes images and writes manifest + thumbnails.
- **packages/data / packages/utils / packages/hooks / packages/ui**: Shared data access, utilities, hooks and design system.

## Data Storage

- **D1** — users, sessions, photo assets, comments, reactions, settings, manifest state.
- **R2** — original photos, derived thumbnails, generated manifest, OG image cache, backups.
- **KV** — hot caches and manifest revision counters.

## Data Flow

1. Builder (or the dashboard upload pipeline) writes photo objects and metadata.
2. `ManifestSyncService` rebuilds `manifest.json` in R2 and bumps the manifest revision in KV/D1.
3. The SPA loads the manifest over HTTP; the Worker serves it with ETag revalidation.
4. The Worker answers gallery SEO/OG requests and public API routes from D1, R2 and KV.

## Key Traits

- No tenant resolution, subdomains, billing or per-user storage configuration.
- Registration is disabled; the owner account is created with `pnpm bootstrap:admin`.
- Uploads use presigned R2 URLs when credentials are configured, otherwise the Worker proxies the upload.
- Shared types between builder, SPA and the Worker keep the manifest schema aligned.

See `be/apps/core/AGENTS.md` for backend module details.
