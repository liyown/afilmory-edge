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

## Worker Secrets (`apps/edge/.dev.vars` / `cf secret put`)

- `CONFIG_ENCRYPTION_KEY` — encrypts sensitive settings in D1 (required).
- `BETTER_AUTH_SECRET` — optional; falls back to `CONFIG_ENCRYPTION_KEY`.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL` — presigned uploads.
  Omit them to proxy uploads through the Worker.
- `OG_THUMBNAIL_ORIGIN` — optional origin override for OG images.

Bindings (`DB`, `PHOTOS`, `CACHE`, `ASSETS`) are declared in `apps/edge/cloudflare.config.ts`.

## App Commands (common)

```bash
pnpm dev                            # Worker + web app
pnpm --filter @afilmory/dashboard dev  # Admin dashboard only
pnpm build                          # Production build
pnpm deploy:edge                    # Deploy the Worker
pnpm --filter web type-check
pnpm lint && pnpm format
```
