# Deployment & Hosting

Afilmory Edge deploys as one Cloudflare Worker plus D1 and KV bindings, with photos stored either in Cloudflare R2 (native binding) or in an S3-compatible bucket such as Aliyun OSS. The two paths share the same Worker bundle and code.

| Path | Storage | Configuration | Owner creation |
| --- | --- | --- | --- |
| Deploy to Cloudflare button / Wrangler | R2 binding (`PHOTOS`) | Root `wrangler.jsonc` | Web setup with `SETUP_TOKEN` |
| Manual `cf` CLI deployment | Aliyun OSS over the S3 API | `apps/edge/cloudflare.config.ts` | Web setup or `bootstrap:admin` |

## Option A: one-click deployment (R2)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/liyown/afilmory-edge)

The button copies the repository into your GitHub account, runs `pnpm build`, provisions D1, KV, and R2 from `wrangler.jsonc`, applies the D1 migrations, and deploys with `pnpm deploy`.

### Secrets

The deployment flow reads `.dev.vars.example` from the repository root and asks for:

| Secret | Required | Purpose |
| --- | --- | --- |
| `CONFIG_ENCRYPTION_KEY` | Yes | Encrypts settings stored in D1. Generate with `openssl rand -base64 32` |
| `BETTER_AUTH_SECRET` | No | Signs auth sessions; falls back to `CONFIG_ENCRYPTION_KEY` |
| `SETUP_TOKEN` | Yes for first-run setup | One-time token that gates owner creation |

The R2 driver is selected automatically because the `PHOTOS` binding exists. No `S3_*` secrets are needed.

### Equivalent local commands

```bash
pnpm install
pnpm build
pnpm deploy        # wrangler d1 migrations apply DB --remote && wrangler deploy
```

`pnpm deploy` requires a Wrangler login (`wrangler login`) or `CLOUDFLARE_API_TOKEN`. `pnpm db:migrate:d1` runs only the migration step.

### Local R2 development

```bash
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
STORAGE_DRIVER=r2 pnpm dev
```

`STORAGE_DRIVER=r2` tells `apps/edge/cloudflare.config.ts` to add a local R2 binding. Uploads are proxied through the Worker at `/api/photos/upload/*`; files above 80 MiB are uploaded in 8 MiB multipart chunks.

### Create the owner

Open `https://<worker>.<subdomain>.workers.dev/platform/login`. When `auth_user` is empty, the page switches to the owner setup form. Enter the `SETUP_TOKEN` chosen during deployment plus your email and password. The API refuses the request when the token is missing or wrong, and only the first successful claim creates a user.

## Option B: manual deployment (Aliyun OSS)

### 1. Create resources

```bash
cf d1 create --name afilmory-db
```

Create a private OSS bucket in the Aliyun console and note its region. Bindings are declared in `apps/edge/cloudflare.config.ts` (`DB`, `CACHE`, `ASSETS`). The KV namespace is provisioned automatically by the `bindings.kv({})` declaration on first deploy.

### 2. Configure secrets

Production secrets are set per Worker:

```bash
cf workers secrets update CONFIG_ENCRYPTION_KEY --type secret_text --worker afilmory-edge
cf workers secrets update BETTER_AUTH_SECRET --type secret_text --worker afilmory-edge
cf workers secrets update SETUP_TOKEN --type secret_text --worker afilmory-edge
cf workers secrets update S3_ENDPOINT --type secret_text --worker afilmory-edge
cf workers secrets update S3_REGION --type secret_text --worker afilmory-edge
cf workers secrets update S3_ACCESS_KEY_ID --type secret_text --worker afilmory-edge
cf workers secrets update S3_SECRET_ACCESS_KEY --type secret_text --worker afilmory-edge
```

The CLI prompts for each value; pass `--text <value>` instead for non-interactive setups. `BETTER_AUTH_SECRET` is optional and falls back to `CONFIG_ENCRYPTION_KEY`. `SETUP_TOKEN` enables the first-run owner form; when it is absent the dashboard reports that setup is disabled.

`S3_ENDPOINT` is the virtual-hosted bucket URL (`https://<bucket>.s3.oss-<region>.aliyuncs.com`), so the bucket name is part of the host. Media is always served through the Worker's `/media/*` proxy; never make the bucket public, because it also stores D1 backups under `backups/d1/`.

For local development, copy `apps/edge/.dev.vars.example` to `apps/edge/.dev.vars`. Leave `STORAGE_DRIVER` unset (or set it to `s3`) to use the OSS driver.

### 3. Apply the D1 schema

```bash
cf d1 migrations apply <database-id> --dir be/packages/db/migrations
```

The command targets the remote database by default and requires the database ID, not its name (find it with `cf d1 list`); pass `--local` to target the local dev database.

Migrations are generated into `be/packages/db/migrations` from `be/packages/db/src/schema.ts`:

```bash
pnpm -C be/packages/db db:generate
```

### 4. Build and deploy

```bash
pnpm build          # gallery SPA + dashboard + Worker
pnpm deploy:edge
```

`pnpm build` runs the web and dashboard Vite builds, syncs their output into `apps/edge/public`, and bundles the Worker with `cf build`.

CI (`.github/workflows/build.yml`) runs lint, package tests, `pnpm build`, and `pnpm type-check` on every push and pull request.

### 5. Create the owner account

Either use the setup form at `/platform/login` after deploy (requires `SETUP_TOKEN`), or run the CLI:

```bash
pnpm bootstrap:admin --email you@example.com \
  --account-id <account-id> --database-id <database-id> --api-token <api-token>
```

Use `--local` to target the local D1 file created by `pnpm dev`. The script creates the superadmin user and credential account. It is idempotent; rerun it with `--password` to rotate the password.

## 6. Post-deploy checklist

- `GET /health` returns `{"ok":true}`, and `GET /api/health` reports D1, object storage, and KV as `ok`
- `GET /media/backups/d1/<file>.json.gz` returns `404`
- Open `/platform`, sign in as the owner, then upload and delete a test photo
- Confirm video and Live Photo playback can seek (`Range` requests return `206`)
- Set the Site URL in dashboard settings; feed and sitemap fall back to `http://localhost` without it
- Verify `/photos/<id>`, `/og/<id>`, `/feed.xml`, `/sitemap.xml` and `/share/iframe?id=<photo>`
- Download the latest backup and run the restore script against local D1 (see below)

## Security notes

- `/media/*` only serves keys under the `photos/` prefix, so D1 backups in the same bucket stay private.
- CORS only accepts the request's own origin; the deployment is same-origin.
- The Worker adds `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: SAMEORIGIN` (except `/share/*`), media sandbox CSP, and HSTS on HTTPS responses.
- Registration is disabled. The only account is the one created by the owner setup form or `bootstrap:admin`.
- The upload proxy at `/api/photos/upload/*` requires a superadmin session and only accepts `photos/` keys.
- Add a Cloudflare WAF rate-limiting rule for `/api/auth/*` and `/api/setup/*` to slow credential stuffing.

## Backups

The Worker runs a daily cron that exports D1 into object storage under `backups/d1/` and keeps 14 copies. Backups share the photos bucket but are not reachable over HTTP. Download them with `wrangler r2 object get` (R2 path), `ossutil cp` (OSS path), or any S3 client. To restore locally:

```bash
# R2
wrangler r2 object get afilmory-photos/backups/d1/<file>.json.gz --file ./backup.json.gz

# OSS
ossutil cp oss://<bucket>/backups/d1/<file>.json.gz ./backup.json.gz

pnpm restore:d1-backup --file ./backup.json.gz --local
```

Run a restore drill before relying on the backup schedule. Point the restore at a scratch local database first, then verify row counts and a dashboard login.
