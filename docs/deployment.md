# Deployment & Hosting

Afilmory deploys as one Cloudflare Worker plus D1, R2 and KV bindings.

## 1. Create Cloudflare resources

```bash
cf d1 create afilmory-db
cf r2 bucket create afilmory-photos
cf kv namespace create AFILMORY_CACHE
```

Bindings are declared in `apps/edge/cloudflare.config.ts` (`DB`, `PHOTOS`, `CACHE`, `ASSETS`).

## 2. Configure secrets

Production secrets are set per Worker:

```bash
cf secret put CONFIG_ENCRYPTION_KEY
cf secret put BETTER_AUTH_SECRET          # optional; falls back to CONFIG_ENCRYPTION_KEY
cf secret put R2_ACCOUNT_ID
cf secret put R2_ACCESS_KEY_ID
cf secret put R2_SECRET_ACCESS_KEY
cf secret put R2_BUCKET_NAME
cf secret put R2_PUBLIC_BASE_URL
```

If the R2 S3 credentials are omitted, uploads are proxied through the Worker instead of using presigned URLs.

`R2_PUBLIC_BASE_URL` must stay at `/media` (the default) or point at a Worker-controlled hostname. Never point it at a public R2 bucket domain or an `r2.dev` URL: the photos bucket also stores D1 backups under `backups/d1/`, so public bucket access would expose the entire database.

For local development, copy `apps/edge/.dev.vars.example` to `apps/edge/.dev.vars`.

## 3. Apply the D1 schema

```bash
cf d1 migrations apply afilmory-db --remote
```

Migrations are generated into `be/packages/db/migrations` from `be/packages/db/src/schema.ts`:

```bash
pnpm -C be/packages/db db:generate
```

## 4. Build and deploy

```bash
pnpm build          # gallery SPA + dashboard + Worker
pnpm deploy:edge
```

`pnpm build` runs the web and dashboard Vite builds, syncs their output into `apps/edge/public`, and bundles the Worker with `cf build`.

CI (`.github/workflows/build.yml`) runs lint, package tests, `pnpm build`, and `pnpm type-check` on every push and pull request.

## 5. Create the owner account

```bash
pnpm bootstrap:admin --email you@example.com \
  --account-id <account-id> --database-id <database-id> --api-token <api-token>
```

Use `--local` to target the local D1 file created by `pnpm dev`. The script creates the superadmin user and credential account. It is idempotent; rerun it with `--password` to rotate the password.

## 6. Post-deploy checklist

- `GET /health` returns `{"ok":true}`, and `GET /api/health` reports D1, R2 and KV as `ok`
- `GET /media/backups/d1/<file>.json.gz` returns `404`
- Open `/platform`, sign in as the bootstrap admin, then upload and delete a test photo
- Set the Site URL in dashboard settings; feed and sitemap fall back to `http://localhost` without it
- Verify `/photos/<id>`, `/og/<id>`, `/feed.xml`, `/sitemap.xml` and `/share/iframe?id=<photo>`
- Download the latest backup and run the restore script against local D1 (see below)

## Security notes

- `/media/*` only serves keys under the `photos/` prefix, so D1 backups in the same bucket stay private.
- CORS only accepts the request's own origin; the deployment is same-origin.
- The Worker adds `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: SAMEORIGIN` (except `/share/*`), media sandbox CSP, and HSTS on HTTPS responses.
- Registration is disabled. The only account is the one created by `bootstrap:admin`.
- Add a Cloudflare WAF rate-limiting rule for `/api/auth/*` to slow credential stuffing.

## Backups

The Worker runs a daily cron that exports D1 into R2 under `backups/d1/` and keeps 14 copies. Backups share the photos bucket but are not reachable over HTTP; retrieve them with the R2 CLI. To restore locally:

```bash
cf r2 object get backups/d1/<file>.json.gz --file ./backup.json.gz
pnpm restore:d1-backup --file ./backup.json.gz --local
```

Run a restore drill before relying on the backup schedule. Point the restore at a scratch local database first, then verify row counts and a dashboard login.
