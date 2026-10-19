# Documentation

Afilmory runs as a personal, single-tenant photo gallery on Cloudflare: one Worker serves the React SPA, the admin dashboard, and the API, backed by D1, KV, and Aliyun OSS.
Photos are uploaded from the dashboard; the Worker extracts metadata, stores thumbnails, and publishes the manifest.

- Architecture overview: `architecture.md`
- Configuration guide (site settings + Worker secrets): `configuration.md`
- Deployment and hosting: `deployment.md`

For day-to-day development commands, see the root `README.md`.
