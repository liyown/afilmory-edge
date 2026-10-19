# Backend

Backend code for the Afilmory Edge personal gallery.
Everything runs inside the Cloudflare Worker in `apps/edge` except the optional OAuth callback broker.

## Layout

```
be/
├── apps/
│   ├── core/          # Hono API module graph (runs in the Worker)
│   ├── dashboard/     # Owner dashboard SPA
│   └── oauth-gateway/ # Standalone OAuth callback broker
└── packages/
    ├── db/            # D1 schema + Drizzle migrations
    ├── env/           # Worker binding access (cloudflare:workers env)
    └── utils/         # Shared backend utilities
```

## Runtime

- **API**: `@tsuki-hono` modules/controllers/decorators on Hono, with tsyringe DI.
- **Database**: Cloudflare D1 through `drizzle-orm/d1`.
- **Cache**: Cloudflare KV through `CacheService`.
- **Object storage**: Aliyun OSS over the S3 API.
- **Auth**: Better Auth with the Drizzle SQLite adapter; registration is closed.
- **Events**: in-process event emitter.
  There is no Redis or external queue.

## Commands

```bash
pnpm -C be/apps/core test          # vitest
pnpm -C be/apps/core bootstrap:admin --email you@example.com
pnpm -C be/apps/core restore:d1-backup --file ./backup.json.gz --local
pnpm -C be/packages/db db:generate # regenerate D1 migrations
```

See `apps/core/AGENTS.md` for module details and `docs/deployment.md` for deployment.
