# Deployment & Hosting

Afilmory deploys as one Cloudflare Worker plus D1 and KV bindings, with photos stored in an Aliyun OSS bucket over the S3 API.

## 1. Create resources

```bash
cf d1 create --name afilmory-db
```

Create a private OSS bucket in the Aliyun console and note its region. Bindings are declared in `apps/edge/cloudflare.config.ts` (`DB`, `CACHE`, `ASSETS`). The KV namespace is provisioned automatically by the `bindings.kv({})` declaration on first deploy.

## 2. Configure secrets

Production secrets are set per Worker:

```bash
cf workers secrets update CONFIG_ENCRYPTION_KEY --type secret_text --worker afilmory-edge
cf workers secrets update BETTER_AUTH_SECRET --type secret_text --worker afilmory-edge
cf workers secrets update S3_ENDPOINT --type secret_text --worker afilmory-edge
cf workers secrets update S3_REGION --type secret_text --worker afilmory-edge
cf workers secrets update S3_ACCESS_KEY_ID --type secret_text --worker afilmory-edge
cf workers secrets update S3_SECRET_ACCESS_KEY --type secret_text --worker afilmory-edge
```

The CLI prompts for each value; pass `--text <value>` instead for non-interactive setups. `BETTER_AUTH_SECRET` is optional and falls back to `CONFIG_ENCRYPTION_KEY`.

`S3_ENDPOINT` is the virtual-hosted bucket URL (`https://<bucket>.s3.oss-<region>.aliyuncs.com`), so the bucket name is part of the host. Media is always served through the Worker's `/media/*` proxy; never make the bucket public, because it also stores D1 backups under `backups/d1/`.

For local development, copy `apps/edge/.dev.vars.example` to `apps/edge/.dev.vars`.

## 3. Apply the D1 schema

```bash
cf d1 migrations apply <database-id> --dir be/packages/db/migrations
```

The command targets the remote database by default and requires the database ID, not its name (find it with `cf d1 list`); pass `--local` to target the local dev database.

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

- `GET /health` returns `{"ok":true}`, and `GET /api/health` reports D1, OSS storage and KV as `ok`
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

The Worker runs a daily cron that exports D1 into OSS under `backups/d1/` and keeps 14 copies. Backups share the photos bucket but are not reachable over HTTP; download them with `ossutil` or any S3 client. To restore locally:

```bash
ossutil cp oss://<bucket>/backups/d1/<file>.json.gz ./backup.json.gz
pnpm restore:d1-backup --file ./backup.json.gz --local
```

Run a restore drill before relying on the backup schedule. Point the restore at a scratch local database first, then verify row counts and a dashboard login.
