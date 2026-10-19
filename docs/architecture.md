# Architecture Overview

- **apps/web**: React 19 + Vite SPA. Consumes `photos-manifest.json` and thumbnails under `apps/web/public`. Runs standalone or with injected manifest.
- **apps/edge**: Cloudflare Worker. Serves the SPA and dashboard, injects the manifest from R2 for SEO/OG, renders dynamic OG images, mounts the core API, and runs scheduled backup/cleanup.
- **packages/builder**: Photo pipeline. Syncs from storage (S3/B2/GitHub/local/Eagle), processes images, and writes manifest + thumbnails into the SPA.
- **packages/data / packages/utils / packages/hooks / packages/components / packages/ui**: Shared data access, utilities, hooks, and design system pieces.
- **be/**: Core backend (Hono) and dashboard apps, mounted into `apps/edge`. Tenant/auth logic lives here; see `docs/backend/*` and `be/apps/*/AGENTS.md`.

## Data Flow

1. Builder downloads photos from configured storage.
2. Generates thumbnails and `photos-manifest.json` (`apps/web/src/data/photos-manifest.json`).
3. SPA loads manifest either from the bundled JSON or `window.__MANIFEST__` injected by the Worker.
4. The Worker wraps the SPA shell for SEO/OG and serves API/social routes from D1 + R2.

## Key Traits

- Incremental sync to avoid reprocessing unchanged photos.
- Adapter pattern for storage providers.
- Shared types between builder, SPA, and the Worker backend to keep manifest schema aligned.
