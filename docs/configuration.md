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

## Worker Secrets (`.dev.vars` / secrets store)

- `CONFIG_ENCRYPTION_KEY` — encrypts sensitive settings in D1 (required).
- `BETTER_AUTH_SECRET` — optional; falls back to `CONFIG_ENCRYPTION_KEY`.
- `SETUP_TOKEN` — one-time token for the first-run owner form at `/platform/login`.
- `STORAGE_DRIVER` — `r2` or `s3`; optional when the `PHOTOS` binding makes the choice obvious.
- `S3_ENDPOINT` — virtual-hosted bucket URL, e.g. `https://<bucket>.s3.oss-<region>.aliyuncs.com` (S3 driver only).
- `S3_REGION` — OSS region, e.g. `cn-shenzhen` (S3 driver only).
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — credentials with read/write access to the bucket (S3 driver only).

Bindings (`DB`, `CACHE`, `ASSETS`, and optionally `PHOTOS`) are declared in `apps/edge/cloudflare.config.ts` for the `cf` deployment, or in the root `wrangler.jsonc` for the one-click deployment. The S3 values are Worker secrets.

## Storage Drivers

| Driver | Selected when | Uploads | Reads |
| --- | --- | --- | --- |
| `r2` | `STORAGE_DRIVER=r2` or the `PHOTOS` R2 binding exists | Proxied through `/api/photos/upload/*`; multipart above 80 MiB | Native R2 binding, `Range` supported |
| `s3` | Default when no R2 binding is present | Presigned direct multipart uploads from the browser | S3 API with `Range` support |

Both drivers expose the same `/media/*` proxy, so the bucket stays private. R2 bindings cannot presign URLs, which is why that driver proxies uploads through the Worker instead.

### Object storage example (Aliyun OSS)

```bash
S3_ENDPOINT=https://<bucket>.s3.oss-<region>.aliyuncs.com
S3_REGION=cn-shenzhen
S3_ACCESS_KEY_ID=<access-key-id>
S3_SECRET_ACCESS_KEY=<access-key-secret>
```

The endpoint is the virtual-hosted bucket URL, so the bucket name is part of the host. Keep the bucket private: the Worker issues presigned upload URLs, reads originals with range requests, and serves media through `/media/*`. The bucket layout is:

- `photos/` — originals, thumbnails, and Live Photo/Motion Photo videos
- `manifest.json` — the rendered gallery manifest
- `og/` — cached OpenGraph images
- `backups/d1/` — daily D1 exports (not reachable over HTTP)

## App Commands (common)

```bash
pnpm dev                            # Worker + web app
pnpm --filter @afilmory/dashboard dev  # Admin dashboard only
pnpm build                          # Production build
pnpm deploy:edge                    # Deploy the Worker
pnpm --filter web type-check
pnpm lint && pnpm format
```
