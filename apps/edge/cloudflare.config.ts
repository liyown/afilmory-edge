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
      PHOTOS: bindings.r2({ name: 'afilmory-photos' }),
      CACHE: bindings.kv({}),
      ASSETS: bindings.assets(),
      CONFIG_ENCRYPTION_KEY: bindings.secret(),
      BETTER_AUTH_SECRET: bindings.secret(),
      // Direct-to-R2 uploads. Set these with `cf secret put <NAME>` in
      // production; local dev may use `disabled` to exercise the Worker-proxied
      // fallback path.
      R2_ACCOUNT_ID: bindings.secret(),
      R2_ACCESS_KEY_ID: bindings.secret(),
      R2_SECRET_ACCESS_KEY: bindings.secret(),
      R2_BUCKET_NAME: bindings.secret(),
      R2_PUBLIC_BASE_URL: bindings.secret(),
    },
    assets: {
      htmlHandling: 'auto-trailing-slash',
      notFoundHandling: 'single-page-application',
      runWorkerFirst: [
        '/',
        '/health',
        '/dashboard',
        '/dashboard/*',
        '/feed.xml',
        '/sitemap.xml',
        '/media/*',
        '/api/*',
        '/og',
        '/og/*',
        '/photos/*',
        '/platform',
        '/platform/*',
        '/share/*',
      ],
    },
    triggers: [triggers.scheduled({ schedule: HOURLY_CRON }), triggers.scheduled({ schedule: DAILY_BACKUP_CRON })],
    observability: {
      enabled: true,
    },
  },
})
