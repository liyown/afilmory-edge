import process from 'node:process'

import { bindings, defineConfig, triggers } from 'cf/config'

import * as entrypoint from './src/index.ts' with { type: 'cf-worker' }

// Keep in sync with src/cron.ts (the dev server cannot import Worker source
// from the config module).
const HOURLY_CRON = '0 * * * *'
const DAILY_BACKUP_CRON = '30 2 * * *'

// The OSS deployment leaves this unset; the one-click R2 deployment (or local
// R2 development) opts in with STORAGE_DRIVER=r2.
const STORAGE_DRIVER = process.env.STORAGE_DRIVER
const AI_INDEX_ENABLED = process.env.AI_INDEX_ENABLED ?? 'true'
const AI_VISION_MODEL = process.env.AI_VISION_MODEL ?? '@cf/mistralai/mistral-small-3.1-24b-instruct'
const AI_EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL ?? '@cf/baai/bge-m3'

export default defineConfig({
  worker: {
    name: 'afilmory-edge',
    compatibilityDate: '2026-10-18',
    entrypoint,
    env: {
      DB: bindings.d1({ name: 'afilmory-db' }),
      CACHE: bindings.kv({}),
      ASSETS: bindings.assets(),
      PHOTOS: STORAGE_DRIVER === 'r2' ? bindings.r2({ name: 'afilmory-photos' }) : false,
      ...(AI_INDEX_ENABLED === 'false'
        ? {}
        : {
            AI: bindings.ai({ dev: { remote: true } }),
            VECTORIZE: bindings.vectorize({ name: 'afilmory-photo-embeddings', dev: { remote: true } }),
          }),
      AI_VISION_MODEL: bindings.text(AI_VISION_MODEL),
      AI_EMBEDDING_MODEL: bindings.text(AI_EMBEDDING_MODEL),
      AI_INDEX_ENABLED: bindings.text(AI_INDEX_ENABLED),
      CONFIG_ENCRYPTION_KEY: bindings.secret(),
      BETTER_AUTH_SECRET: bindings.secret(),
      SETUP_TOKEN: bindings.secret(),
      // S3-compatible object storage (Aliyun OSS). Set these with
      // `cf workers secrets update <NAME> --type secret_text --worker afilmory-edge`.
      S3_ENDPOINT: bindings.secret(),
      S3_REGION: bindings.secret(),
      S3_ACCESS_KEY_ID: bindings.secret(),
      S3_SECRET_ACCESS_KEY: bindings.secret(),
    },
    assets: {
      htmlHandling: 'auto-trailing-slash',
      // SPA fallbacks are rendered by the Worker so every route receives the
      // injected manifest/config; missing files should surface as real 404s.
      notFoundHandling: 'none',
      // The Worker renders the injected gallery shell for every extensionless
      // route, so it must see all requests; static files are forwarded to the
      // ASSETS binding in `src/index.ts`.
      runWorkerFirst: true,
    },
    triggers: [triggers.scheduled({ schedule: HOURLY_CRON }), triggers.scheduled({ schedule: DAILY_BACKUP_CRON })],
    observability: {
      enabled: true,
    },
  },
})
