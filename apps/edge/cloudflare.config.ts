import { bindings, defineConfig, triggers } from 'cf/config'

import * as entrypoint from './src/index.ts' with { type: 'cf-worker' }

// Keep in sync with src/cron.ts (the dev server cannot import Worker source
// from the config module).
const HOURLY_CRON = '0 * * * *'
const DAILY_BACKUP_CRON = '30 2 * * *'

export default defineConfig({
  worker: {
    name: 'afilmory-edge',
    compatibilityDate: '2026-10-18',
    entrypoint,
    env: {
      DB: bindings.d1({ name: 'afilmory-db' }),
      CACHE: bindings.kv({}),
      ASSETS: bindings.assets(),
      CONFIG_ENCRYPTION_KEY: bindings.secret(),
      BETTER_AUTH_SECRET: bindings.secret(),
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
