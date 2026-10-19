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

## 5. Create the owner account

```bash
pnpm bootstrap:admin --email you@example.com \
  --account-id <account-id> --database-id <database-id> --api-token <api-token>
```

Use `--local` to target the local D1 file created by `pnpm dev`. The script creates the superadmin user and credential account. It is idempotent; rerun it with `--password` to rotate the password.

## Backups

The Worker runs a daily cron that exports D1 into R2 under `backups/d1/`. To restore locally:

```bash
cf r2 object get backups/d1/<file>.json.gz --file ./backup.json.gz
pnpm restore:d1-backup --file ./backup.json.gz --local
```
