# agents.md

## `be/apps/core` - Backend Architecture

Hono API used by the Cloudflare Worker in `apps/edge`.
There is no standalone Node server: the Worker boots this module graph with D1 and KV bindings plus S3-compatible object storage.

### Core Technologies

- **Web Framework**: **Hono**
- **Dependency Injection**: **tsyringe** via `@tsuki-hono` decorators
- **ORM**: **Drizzle ORM** (`drizzle-orm/d1`)
- **Database**: **Cloudflare D1** (SQLite)
- **Cache**: **Cloudflare KV**
- **Object storage**: **Aliyun OSS** (S3-compatible, `apps/edge/src/storage.ts`)

### Architecture Overview

- **Modules**: Feature modules under `src/modules` declare controllers, services and DTOs. `apps/edge/src/core-app.ts` composes the modules that run in the Worker.
- **Database access**: `DbAccessor` exposes the D1 drizzle client. `runAtomically` maps to `db.batch()` so multi-statement writes stay atomic.
- **Bindings**: `@afilmory/env` reads `cloudflare:workers` `env`, so services use bindings directly instead of a custom environment layer.
- **Request lifecycle**: Hono middleware → controller → injected service → D1/OSS/KV.
- **Authentication**: Better Auth with the Drizzle SQLite adapter.
  Registration is disabled; the owner account is created with `pnpm bootstrap:admin`.
- **Events**: In-process event emitter; there is no external queue.

### Worker composition

The Worker (`apps/edge`) owns:

- Static assets: gallery SPA and dashboard.
- API: this core module graph under `/api`.
- SEO/OG, manifest serving, sitemap, feed and well-known routes.
- Scheduled backup/cleanup via cron.

### Tests

Vitest runs against an in-memory `node:sqlite` harness that applies the D1 migrations from `be/packages/db/migrations`. `vitest.config.ts` aliases `cloudflare:workers` and `@afilmory/env` to Node-side stand-ins.
