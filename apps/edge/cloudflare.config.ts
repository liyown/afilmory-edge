import { bindings, defineConfig } from 'cf/config'

import * as entrypoint from './src/index.ts' with { type: 'cf-worker' }

export default defineConfig({
  worker: {
    name: 'afilmory-edge',
    compatibilityDate: '2026-10-18',
    entrypoint,
    env: {
      WORLD: bindings.text('World'),
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
        '/media/*',
        '/api/*',
        '/og/*',
        '/photos/*',
        '/platform',
        '/platform/*',
        '/share/*',
      ],
    },
    observability: {
      enabled: true,
    },
  },
})
