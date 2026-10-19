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
    },
    assets: {
      htmlHandling: 'auto-trailing-slash',
      notFoundHandling: 'single-page-application',
      runWorkerFirst: ['/', '/health', '/media/*', '/api/*', '/og/*', '/photos/*', '/share/*'],
    },
    observability: {
      enabled: true,
    },
  },
})
