# Origin & Differences

## What this project is

**Afilmory Edge** is an independent, personal derivative of [Afilmory](https://github.com/Afilmory/Afilmory), a photography gallery project. The name keeps **Afilmory** — **A**uto **F**ocus, **A**perture, **F**ilm, and **M**emory — and adds **Edge** to describe its Cloudflare-native, single-Worker deployment.

This repository is not a drop-in fork that tracks upstream commits. It is a fresh, single-tenant codebase shaped around one person's gallery, one Cloudflare account, and one private OSS bucket.

## Upstream

- Project: [Afilmory](https://github.com/Afilmory/Afilmory)
- Creator: [Innei](https://innei.in)
- License: Attribution Network License (ANL) v1.0 — see [LICENSE](./LICENSE)

The gallery UI, WebGPU/WebGL viewer, masonry layout, EXIF pipeline, and visual design originate from Afilmory. Credit for those belongs to the upstream authors and contributors.

## Why this derivative exists

Upstream Afilmory supports a broad platform surface: multiple deployment targets, a SaaS/tenant layer, hosted storage options, an iOS client, and a builder toolkit. This deployment only needs a private gallery owned by one person, running entirely on Cloudflare with photos stored in Aliyun OSS.

Rather than carrying unused paths, Afilmory Edge was rebuilt around that single use case.

## Key differences

| Area | Afilmory (upstream) | Afilmory Edge (this repository) |
| --- | --- | --- |
| Deployment | Multiple services and deployment targets | One Cloudflare Worker |
| Tenancy | Multi-tenant / platform capability | Single tenant, single owner |
| Frontend delivery | Separate web, dashboard, and API origins | Gallery SPA, dashboard SPA, and API served from the same Worker |
| Object storage | Cloudflare R2 / configurable providers | Aliyun OSS over the S3 API (private bucket) |
| Database | PostgreSQL / hosted options | Cloudflare D1 (SQLite) only |
| Cache | Redis and other options | Cloudflare KV only |
| Upload path | Provider-specific pipelines, Worker-proxied fallback | Direct presigned multipart uploads to OSS; no Worker proxying |
| Authentication | Broad sign-up and social login | Owner account only; registration closed; social login can only attach to the existing owner |
| Site settings | Platform configuration surface | Owner-managed settings stored in D1 and injected into every shell response |
| Clients | Web, iOS, builder | Web gallery and dashboard only |
| Migrations | Incremental history including removed services | Single fresh D1 baseline; no legacy data migration |

### Removed from upstream

- Multi-tenant and SaaS modules (tenant resolution, billing, managed-storage, push).
- The iOS application and mobile-specific API surface.
- The builder package and its build scripts.
- PostgreSQL, Redis, and other non-Cloudflare runtime paths.
- Historical migration and compatibility shims.

### Added or reshaped here

- A Worker entry point that serves assets, API, dashboard routing, OG images, sitemap, feed, cron maintenance, and share embeds.
- An S3-compatible storage abstraction (`apps/edge/src/storage.ts`) targeting Aliyun OSS.
- Presigned upload intents, multipart uploads, range reads, and a signed `/media/*` proxy so the bucket stays private.
- D1-backed site identity (name, title, author, avatar) injected into the gallery shell and dashboard.
- Runtime branding configuration for the dashboard.
- D1 backup and restore scripts that write to the same private bucket.
- Documentation rewritten for the single-Worker personal deployment.

## Data compatibility

There is no migration path from an upstream Afilmory database or bucket. D1 uses a fresh baseline schema and the storage key layout is specific to this deployment. Treat this as a new project.

## Syncing with upstream

Selective cherry-picks are possible for self-contained pieces such as the image viewer, UI components, or EXIF parsing. Whole-tree merges are not supported because this repository intentionally diverges in runtime, schema, and module structure.
