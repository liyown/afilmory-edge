# Configuration Guide

## Site Presentation (`config.json`)

- `name`, `title`, `description`, `url`, `accentColor`
- `author`: `{ name, url, avatar }`
- `social`: `{ github?, twitter? }`
- `feed`: optional `folo.challenge.feedId` and `userId`
- `map`: e.g. `["maplibre"]`
- `mapStyle`: `builtin` or provider style
- `mapProjection`: `globe` or `mercator`
- `viewer.regions.labelPlacement`: `edge` (label at the region corner) or `floating` (label centered above the region)

`config.json` merges into `site.config.ts` and is used by the gallery SPA at build time.

## Builder Config (`builder.config.ts`)

Use `defineBuilderConfig` from `@afilmory/builder`. See `builder.config.default.ts` for the full shape:

- **storage**: provider (`s3`, `local`), credentials, prefix, custom domain, `excludeRegex`, concurrency.
- **system.processing**: `defaultConcurrency`, `enableLivePhotoDetection`, `digestSuffixLength`.
- **system.observability**: progress/stats toggles, logging level/output, worker settings.
- **plugins**: optional lifecycle hooks such as thumbnail storage or repo sync.
- Outputs: thumbnails plus `photos-manifest.json`.

## Worker Secrets (`apps/edge/.dev.vars` / `cf secret put`)

- `CONFIG_ENCRYPTION_KEY` — encrypts sensitive settings in D1 (required).
- `BETTER_AUTH_SECRET` — optional; falls back to `CONFIG_ENCRYPTION_KEY`.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL` — presigned uploads. Omit them to proxy uploads through the Worker.
- `OG_THUMBNAIL_ORIGIN` — optional origin override for OG images.

Bindings (`DB`, `PHOTOS`, `CACHE`, `ASSETS`) are declared in `apps/edge/cloudflare.config.ts`.

## Builder CLI Environment (`.env`)

- Storage: `S3_REGION`, `S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PREFIX`, `S3_CUSTOM_DOMAIN`, `S3_EXCLUDE_REGEX`
- Repo sync (optional): `GIT_TOKEN`

## App Commands (common)

```bash
pnpm dev                            # Worker + web app
pnpm --filter web dev               # SPA only
pnpm run build:manifest             # Build manifest + thumbnails (incremental)
pnpm run build:manifest -- --force  # Full rebuild
pnpm build                          # Production build
pnpm --filter web type-check
pnpm lint && pnpm format
```
