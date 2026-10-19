# Backend Guide for AI Agents

The backend is a single-tenant Cloudflare Worker API.
There is no Node server, PostgreSQL, Redis or task queue to start.

## Packages

| Package                 | Purpose                                  |
| ----------------------- | ---------------------------------------- |
| `be/apps/core`          | Hono API: modules, controllers, services |
| `be/apps/dashboard`     | Dashboard SPA (`/platform`)              |
| `be/apps/oauth-gateway` | Optional OAuth callback broker (Node)    |
| `be/packages/db`        | D1 schema and Drizzle migrations         |
| `be/packages/env`       | Reads `cloudflare:workers` `env`         |
| `be/packages/utils`     | Shared backend helpers                   |

## Request path

1. `apps/edge/src/index.ts` receives the request.
2. Static assets and Worker-owned routes (OG, sitemap, feed, share, well-known, cron) are handled in `apps/edge/src`.
3. `/api/*` is delegated to the module graph in `apps/edge/src/core-app.ts`.
4. Controllers live in `be/apps/core/src/modules/**` and use tsyringe-injected services.

## Rules

- Read bindings through `env` from `cloudflare:workers` (`@afilmory/env`).
  Do not add a second environment abstraction.
- Persist through `DbAccessor` from `be/apps/core/src/database/database.provider.ts`.
  Use `runAtomically` for multi-statement writes; it maps to `db.batch()`.
- Cache through `CacheService` (`env.CACHE`).
  Do not add Redis.
- Keep D1 schema changes in `be/packages/db/src/schema.ts`, then run `pnpm -C be/packages/db db:generate`.
- Tests run in Node with an in-memory SQLite harness (`src/test-utils/d1-sqlite.ts`). `vitest.config.ts` aliases `cloudflare:workers` and `@afilmory/env` to test stand-ins.
- The owner account comes from `pnpm -C be/apps/core bootstrap:admin`; registration is disabled.
- Do not reintroduce tenant ids, tenant resolution, billing, or per-user storage settings.

## Verification

```bash
pnpm -C be/apps/core test
pnpm -C apps/edge type-check
pnpm --filter @afilmory/edge build
```
