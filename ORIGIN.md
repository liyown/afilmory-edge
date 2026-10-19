# Origin & Differences

## What this project is

**Afilmory Edge** is an independent, personal derivative of [Afilmory](https://github.com/Afilmory/Afilmory), a photography gallery project. The name keeps **Afilmory** — **A**uto **F**ocus, **A**perture, **F**ilm, and **M**emory — and adds **Edge** to describe its Cloudflare-native, single-Worker deployment.

This repository is not a drop-in fork that tracks upstream commits. It is a fresh codebase shaped around a personal deployment: one owner's gallery, one Cloudflare account, and one private object storage bucket (R2 or S3-compatible).

## Relationship to upstream

Afilmory Edge is an **unofficial derivative**. It is not affiliated with, sponsored by, or endorsed by the Afilmory team. The Afilmory name and marks belong to their respective owners and are used here only to describe the origin of the code.

If the upstream maintainers prefer a different name, attribution, or presentation, this project will adopt it. See [CREDITS.md](./CREDITS.md) for the people whose work this repository builds on.

## Upstream

- Project: [Afilmory](https://github.com/Afilmory/Afilmory)
- Creator: [Innei](https://innei.in)
- License: Attribution Network License (ANL) v1.0 — see [LICENSE](./LICENSE)

The gallery UI, WebGPU/WebGL viewer, masonry layout, EXIF pipeline, and visual design originate from Afilmory. Credit for those belongs to the upstream authors and contributors.

## Why this derivative exists

Upstream Afilmory supports a broad platform surface: multiple deployment targets, a multi-user SaaS layer, hosted storage options, an iOS client, and a builder toolkit. This deployment only needs a private gallery owned by one person, running entirely on Cloudflare with photos stored in R2 or an S3-compatible bucket.

Rather than carrying unused paths, Afilmory Edge was rebuilt around that single use case.

## Key differences

| Area              | Afilmory (upstream)                                  | Afilmory Edge (this repository)                                                             |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Deployment        | Multiple services and deployment targets             | One Cloudflare Worker                                                                       |
| Scope             | Multi-user platform capability                       | Personal deployment, owner only                                                             |
| Frontend delivery | Separate web, dashboard, and API origins             | Gallery SPA, dashboard SPA, and API served from the same Worker                             |
| Object storage    | Cloudflare R2 / configurable providers               | Cloudflare R2 (one-click) or Aliyun OSS over the S3 API (private bucket)                    |
| Database          | PostgreSQL / hosted options                          | Cloudflare D1 (SQLite) only                                                                 |
| Cache             | Redis and other options                              | Cloudflare KV only                                                                          |
| Upload path       | Provider-specific pipelines, Worker-proxied fallback | Presigned direct uploads to OSS; Worker-proxied uploads for R2                              |
| Authentication    | Broad sign-up and social login                       | Owner account only; registration closed; social login can only attach to the existing owner |
| Site settings     | Platform configuration surface                       | Owner-managed settings stored in D1 and injected into every shell response                  |
| Clients           | Web, iOS, builder                                    | Web gallery and dashboard only                                                              |
| Migrations        | Incremental history including removed services       | Single fresh D1 baseline; no legacy data migration                                          |

### Removed from upstream

- Platform and SaaS modules (workspace resolution, billing, managed storage, push).
- The iOS application and mobile-specific API surface.
- The builder package and its build scripts.
- PostgreSQL, Redis, and other non-Cloudflare runtime paths.
- Historical migration and compatibility shims.

### Added or reshaped here

- A Worker entry point that serves assets, API, dashboard routing, OG images, sitemap, feed, cron maintenance, and share embeds.
- A storage facade (`apps/edge/src/storage.ts`) with a native R2 driver and an S3-compatible driver targeting Aliyun OSS.
- Presigned upload intents for S3, Worker-proxied uploads for R2, multipart uploads, range reads, and a signed `/media/*` proxy so the bucket stays private.
- First-run owner setup protected by a `SETUP_TOKEN`, so a deployment needs no CLI bootstrap.
- D1-backed site identity (name, title, author, avatar) injected into the gallery shell and dashboard.
- Runtime branding configuration for the dashboard.
- D1 backup and restore scripts that write to the same private bucket.
- Documentation rewritten for the single-Worker personal deployment.

## Data compatibility

There is no migration path from an upstream Afilmory database or bucket. D1 uses a fresh baseline schema and the storage key layout is specific to this deployment. Treat this as a new project.

## Syncing with upstream

Selective cherry-picks are possible for self-contained pieces such as the image viewer, UI components, or EXIF parsing. Whole-tree merges are not supported because this repository intentionally diverges in runtime, schema, and module structure.
