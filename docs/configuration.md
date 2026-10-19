# Configuration Guide

## Site Presentation (`config.json`)

Build-time defaults merged into `site.config.ts`:

- `name`, `title`, `description`, `url`, `accentColor`
- `author`: `{ name, url, avatar }`
- `social`: `{ github?, twitter? }`
- `feed`: optional `folo.challenge.feedId` and `userId`
- `map`: e.g. `["maplibre"]`
- `mapStyle`: `builtin` or provider style
- `mapProjection`: `globe` or `mercator`
- `viewer.regions.labelPlacement`: `edge` (label at the region corner) or `floating` (label centered above the region)

Values saved from the dashboard are stored in D1 under `site.*` and injected into every shell request; they take precedence over `config.json`.

## Worker Secrets (`apps/edge/.dev.vars` / `cf workers secrets update`)

- `CONFIG_ENCRYPTION_KEY` — encrypts sensitive settings in D1 (required).
- `BETTER_AUTH_SECRET` — optional; falls back to `CONFIG_ENCRYPTION_KEY`.
- `S3_ENDPOINT` — virtual-hosted bucket URL, e.g. `https://<bucket>.s3.oss-<region>.aliyuncs.com`.
- `S3_REGION` — OSS region, e.g. `cn-shenzhen`.
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — credentials with read/write access to the bucket.

Bindings (`DB`, `CACHE`, `ASSETS`) are declared in `apps/edge/cloudflare.config.ts`; the S3 values are Worker secrets.

## App Commands (common)

```bash
pnpm dev                            # Worker + web app
pnpm --filter @afilmory/dashboard dev  # Admin dashboard only
pnpm build                          # Production build
pnpm deploy:edge                    # Deploy the Worker
pnpm --filter web type-check
pnpm lint && pnpm format
```
