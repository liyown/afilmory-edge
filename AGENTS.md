# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Authoritative Guides

This repo already has detailed `AGENTS.md` files.
Read the one closest to the code you are touching before making non-trivial changes:

- `AGENTS.md` (root) — full commands list, monorepo architecture, manifest/data flow, i18n rules.
- `DESIGN.md` (root) — **the normative design system for `apps/web` + `packages/ui`**: UIKit colour tokens, material/blur roles, radius, typography, spring motion, z-index tiers, layout, iconography, and an explicit list of files that violate the system (§13) and must not be copied.
  Derived from shipped code.
  The `afilmory-web-design` skill is its fast path.
- `apps/web/AGENTS.md` — thin pointer to `DESIGN.md` plus the SPA's red lines and folder structure.
- `be/AGENTS.md` — the NestJS-style Hono framework: modules, controllers, providers, decorators, DI via `tsyringe`, request-scoped context via `AsyncLocalStorage`. **Stale on package names**: it says `@afilmory/framework`, but the framework was extracted to npm as `@tsuki-hono/{core,common,openapi,event-emitter}`.
  The concepts still apply; the import paths don't.
- `be/apps/core/AGENTS.md` — backend core service architecture.
- `DEVELOPMENT.md` — self-host quick start and config field reference (`config.json`, Worker secrets, photo flow).
- `.cursor/rules/*.mdc` — code quality, color (Apple UIKit Tailwind classes), i18n, project description.
- `docs/superpowers/specs/*.md` — dated design specs (`YYYY-MM-DD-<topic>-design.md`) for most non-trivial features.
  Check for an existing spec before redesigning something.

When those files contradict anything below, prefer them (except where flagged stale above).

## Commands

```bash
# Dev
pnpm dev                          # Cloudflare Worker (edge) + SPA on :5173
pnpm --filter web dev             # SPA only
pnpm dev:edge                     # Cloudflare Worker only
pnpm --filter @afilmory/dashboard dev  # Admin dashboard
pnpm docs:dev                     # Docs site

# Build
pnpm build                        # Production build (web + dashboard + Worker)

# DB (Drizzle; schema lives in be/packages/db)
pnpm --filter @afilmory/be db:generate / db:migrate / db:studio

# Quality
pnpm lint                         # eslint --fix (append paths to scope it: `pnpm lint apps/web/src/...`)
pnpm format                       # prettier (apps, packages, be)
pnpm type-check                   # recursive `pnpm -r type-check`
pnpm --filter web type-check      # type-check just the SPA
```

### Tests

There is no repo-wide test runner; tests are per-package and use two different harnesses.

```bash
pnpm --filter @afilmory/be test                    # recursive across be/*
pnpm --filter core test                            # be/apps/core vitest suite (node:sqlite harness)
pnpm --filter @afilmory/oauth-gateway test         # oauth-gateway vitest suite
pnpm --filter @afilmory/viewer-motion test         # node:test via `tsx --test src/*.test.ts`
pnpm exec tsx --test apps/web/src/modules/viewer/entry-animation-state.test.ts  # web's node:test files
```

Single vitest test: `pnpm --filter core exec vitest run src/guards/auth.guard.spec.ts -t "test name"`.
For everything else, verify via `pnpm build`, `pnpm type-check`, `pnpm lint`, and route smoke tests against `pnpm dev`.

Package manager is **pnpm 12** (`packageManager` pin in root `package.json`).
Workspace globs in `pnpm-workspace.yaml`: `apps/**/*`, `packages/*`, `packages/*/*`, `be`, `be/packages/*`, `be/apps/*`.
Pinned versions live in the pnpm `catalog:` (`tailwindcss`, `typescript`, `zod`, `motion`, …) — prefer `catalog:` over a literal version when adding a shared dep.

## Architecture (Big Picture)

Afilmory is a photo gallery composed of several deployable layers, all served by one Cloudflare Worker.

```
┌──────────────────────────────────────────────────────────────────────┐
│  be/apps/dashboard (admin SPA, /platform/)                           │
│    upload intents → OSS → thumbnails/ThumbHash → upload-complete     │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────────┐
│  apps/edge (Cloudflare Worker)                                       │
│    be/apps/core API graph + dashboard API + upload/EXIF pipeline     │
│    D1 · OSS · KV · manifest publication · OG/SEO · cron · assets     │
└────────────────────────────────▲─────────────────────────────────────┘
                                 │ injects __MANIFEST__ / __SITE_CONFIG__
┌────────────────────────────────┴─────────────────────────────────────┐
│  apps/web (Vite + React 19 SPA)                                      │
│    PhotoLoader reads window.__MANIFEST__ (data, cameras, lenses)     │
└──────────────────────────────────────────────────────────────────────┘
```

Key implications when changing things:

- **`apps/web` is the only web UI codebase.** It always runs inside the Worker-served flow and reads `window.__MANIFEST__` / `window.__SITE_CONFIG__`; there is no bundled-manifest fallback.
- **The Worker build owns the SPAs.** `apps/edge` builds `apps/web` (base `/`) and `be/apps/dashboard` (base `/platform/`), then syncs both into `apps/edge/public`. `apps/edge/src/html.ts` rewrites the config and manifest scripts per request from D1/KV.
- **`packages/data`** owns `PhotoLoader` (the singleton that wraps the manifest into lookup maps).
  Anything photo-related goes through it.
  Shared types live in `packages/typing`.
- **The upload pipeline lives in `apps/edge/src/modules/photos`.** It is the only code that talks to object storage (through `apps/edge/src/storage.ts`): upload intents, presigned writes, EXIF/XMP range reads, thumbnail lookup, and manifest publication.
  Dashboard-side work (HEIC decode, thumbnail rendering, ThumbHash, tone analysis) lives in `be/apps/dashboard/src/modules/photos`.
- **`be/`** uses a NestJS-inspired Hono framework (`@tsuki-hono/core`): `@Module`, `@Controller`, `@Get/@Post/...`, `@injectable()`, request context via `AsyncLocalStorage`.
  Don't reach for raw Hono primitives in feature code — use the framework decorators (see `be/AGENTS.md`).
- **`apps/edge` is the production host**, not a separate backend.
  It serves the SPA/dashboard, injects the manifest, renders OG/SEO, and runs scheduled jobs; the API graph comes from `be/apps/core` with D1/SQLite and S3 storage access.
  Heavy domain logic belongs in `be/apps/core`.
- **Two separate design systems**: `apps/web` + `packages/ui` follow the dark, material-and-blur system specified in root `DESIGN.md`; `be/apps/dashboard` is a linear, data-first admin UI.
  Don't mix the two.

### Workspace Map

| Path                         | What it is                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/web`                   | Vite + React 19 SPA — the gallery UI (the only web UI codebase)                                  |
| `apps/edge`                  | Cloudflare Worker: serves SPA/dashboard, injects manifest, dynamic OG/SEO, cron (backup/cleanup) |
| `apps/docs`                  | Vite-based documentation site                                                                    |
| `be/apps/core`               | Hono API graph: DB-backed manifest, REST API, auth, uploads                                      |
| `be/apps/dashboard`          | Admin SPA (served by the Worker under `/platform/`)                                              |
| `be/apps/oauth-gateway`      | Standalone OAuth broker (own Dockerfile)                                                         |
| `be/packages/{db,env,utils}` | Drizzle D1 schema/migrations, Worker env validation, shared backend utils                        |
| `packages/data`              | `PhotoLoader` singleton over the injected manifest                                               |
| `packages/typing`            | Shared photo/manifest types                                                                      |
| `packages/webgl-viewer`      | WebGL photo viewer engine                                                                        |
| `packages/viewer-motion`     | Framework-agnostic viewer motion primitives (has real unit tests)                                |
| `packages/renderer`          | `@afilmory/og-renderer` — OG image rendering                                                     |
| `packages/sdk`               | `@afilmory/sdk` — public SDK + share embed script                                                |
| `packages/{ui,hooks,utils}`  | Shared UI elements, React hooks, utilities                                                       |

## Project Conventions That Matter

- **No feature flags or backwards-compat shims.** App is unreleased — change code in place.
  (Stated explicitly at the bottom of root `AGENTS.md`.)
- **Pages are thin routing shells.** Real UI/logic lives under `modules/<domain>/**` in `apps/web`.
- **State isolation over prop drilling.** For deep subtrees, lift handlers into colocated Jotai/Zustand stores or contexts; don't thread props through layers.
- **Push state down**, not up.
  Feature-local stores/providers; switching tabs should unmount unused logic.
- **Tailwind colors must use the Apple UIKit palette** (`text-text-secondary`, `bg-fill`, `bg-material-thick`, `border-accent/20`, …).
  Full rules in root `DESIGN.md` §2; `.cursor/rules/color.mdc` has the token list.
  No raw hex or `gray-*`/`zinc-*` ramps for chrome; `color-mix()` in an inline style is only for multi-stop gradients and layered shadows.
- **i18n: flat keys with `.` separators**, no nested objects.
  Two namespaces under `locales/`: `app/` (SPA) with `en, zh-CN, zh-HK, zh-TW, jp, ko`, and `dashboard/` (en + zh-CN only).
  Edit `en.json` of the relevant namespace first; ESLint auto-strips keys missing from English in other locales. **Never let a key be both a leaf string and a parent path** (`a.b` cannot coexist with `a.b.c`); the build flattens dots into nested objects and will collide.
  Use `_one`/`_other` for plurals.
- **No bare global `location`** — an ESLint `no-restricted-globals` rule forbids it (the router instance differs between Electron and browser).
  Use `useLocation()` or `getReadonlyRoute()`.
- **Decorators are enabled** (`emitDecoratorMetadata`, `experimentalDecorators`) for the backend framework.
- **`motion` / `motion-dom` are pinned** via pnpm `overrides` (currently `12.38.0`) — don't bump them casually.
  Same for the security-driven `overrides` on `hono`, `vite`, `esbuild`, `qs`, etc.

## Configuration Layering

Two configs, two purposes — don't conflate them:

- `site.config.ts` + `config.json` → **build-time presentation defaults**: name, description, author, social, accent color, map provider/style/projection, feed, beian.
- D1 `site.*` settings → **runtime presentation values**: injected into every shell as `window.__SITE_CONFIG__` and edited from the dashboard.
  These win over `config.json`.

Worker secrets and bindings flow through `@afilmory/env` and `apps/edge/cloudflare.config.ts`; local values live in `apps/edge/.dev.vars`.
