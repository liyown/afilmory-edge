# Architecture Overview

Afilmory is a single-tenant gallery deployment.
One owner account manages one gallery on a single domain.

- **apps/web**: React 19 + Vite SPA.
  Reads the manifest injected by the Worker.
- **apps/edge**: Cloudflare Worker.
  Serves the gallery SPA and dashboard, mounts the core API under `/api`, renders OG/SEO responses, streams dynamic sitemap/feed routes and runs scheduled backup/cleanup.
- **be/apps/core**: Hono API with `@tsuki-hono` modules and tsyringe DI.
  Runs inside the Worker.
- **be/apps/dashboard**: Admin SPA for the owner.
  Uploads photos, edits site settings, manages comments and reactions.
- **be/apps/oauth-gateway**: Standalone OAuth callback broker used only when social login is configured.
- **packages/data / packages/typing / packages/utils / packages/hooks / packages/ui**: Shared data access, types, utilities, hooks and design system.

## Data Storage

- **D1** — users, sessions, photo assets (including manifests), comments, reactions, settings, manifest state.
- **R2** — original photos, generated thumbnails, Live Photo videos, `manifest.json`, OG image cache, backups.
- **KV** — hot caches and manifest revision counters.

## Data Flow

1. The dashboard uploads an original to R2 and sends a thumbnail, ThumbHash, and tone analysis to `upload-complete`.
2. The Worker extracts EXIF/XMP through bounded R2 range reads, detects Live/Motion Photos, and inserts the photo asset into D1.
3. `ManifestPublisher` rebuilds `manifest.json` in R2 from D1 and clears the KV manifest cache.
4. Each HTML shell request injects the current manifest and site settings into the SPA.
5. Feed, sitemap, share, and OG routes read D1 or R2 directly and are generated on demand.

## Key Traits

- No tenant resolution, subdomains, billing or per-user storage configuration.
- Registration is disabled; the owner account is created with `pnpm bootstrap:admin`.
- Uploads use presigned R2 URLs when S3 credentials are configured, otherwise the Worker proxies the upload.
- `packages/typing` is the single source of truth for manifest, EXIF, region, and video types shared by the SPA, dashboard, and Worker.

See `be/apps/core/AGENTS.md` for backend module details.
