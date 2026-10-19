# Documentation

Afilmory Edge runs as a personal photo gallery on Cloudflare: one Worker serves the React SPA, the admin dashboard, and the API, backed by D1, KV, and object storage (Cloudflare R2 or Aliyun OSS).
Photos are uploaded from the dashboard or the `afi` folder-sync CLI; the Worker extracts metadata, stores thumbnails, and publishes the manifest.

- Architecture overview: `architecture.md`
- Configuration guide (site settings + Worker secrets): `configuration.md`
- Deployment and hosting: `deployment.md`
- Local folder sync CLI: `../apps/sync/README.md`
- Netdisk sync research: `netdisk-sync-research.md`
- AI semantic search and auto-tagging: `ai-photo-search.md`

For day-to-day development commands, see the root `README.md`.
