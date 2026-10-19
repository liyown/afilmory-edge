# Architecture Overview

Afilmory Edge is a personal gallery deployment.
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
- **Object storage** — original photos, generated thumbnails, Live Photo videos, `manifest.json`, OG image cache, backups; Cloudflare R2 through the native `PHOTOS` binding, or Aliyun OSS through the S3 API.
- **KV** — hot caches and manifest revision counters.

## Data Flow

1. The dashboard uploads an original — directly with a presigned OSS URL, or through the Worker upload proxy in R2 mode — and sends a thumbnail, ThumbHash, and tone analysis to `upload-complete`.
2. The Worker extracts EXIF/XMP through bounded range reads, detects Live/Motion Photos, and inserts the photo asset into D1.
3. `ManifestPublisher` rebuilds `manifest.json` in object storage from D1 and clears the KV manifest cache.
4. Each HTML shell request injects the current manifest and site settings into the SPA.
5. Feed, sitemap, share, and OG routes read D1 or OSS and are generated on demand.

## Key Traits

- No workspace resolution, subdomains, billing or per-user storage configuration.
- Registration is disabled; the owner account is created through the `SETUP_TOKEN` setup form or `pnpm bootstrap:admin`.
- S3 uploads use presigned URLs and R2 uploads are proxied by the Worker; media is served through the Worker's `/media/*` proxy so the bucket stays private.
- `packages/typing` is the single source of truth for manifest, EXIF, region, and video types shared by the SPA, dashboard, and Worker.

See `be/apps/core/AGENTS.md` for backend module details.
