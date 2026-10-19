import { fileURLToPath } from 'node:url'

import { cloudflare } from '@cloudflare/vite-plugin'
import swc from 'unplugin-swc'
import { defineConfig } from 'vite'

// Single Worker = one assets root. Both SPAs build into this tree:
//   apps/web       -> apps/edge/public
//   dashboard      -> apps/edge/public/dashboard
const SPA_DIST = new URL('./public/', import.meta.url).pathname
const CORE_SRC = fileURLToPath(new URL('../../be/apps/core/src/', import.meta.url))
const DB_SRC = fileURLToPath(new URL('../../be/packages/db/src/', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // T2.2: core code keeps importing the Node provider/module; the Worker
      // build swaps in the D1 implementation and SQLite table definitions.
      {
        find: '@core/database/database.module',
        replacement: `${CORE_SRC}database/database.d1.module.ts`,
      },
      {
        find: '@core/database/database.provider',
        replacement: `${CORE_SRC}database/database.d1.provider.ts`,
      },
      { find: '@afilmory/db', replacement: `${DB_SRC}schema.sqlite.ts` },
      // T3.1: `@afilmory/env` parses `process.env` (dotenv) at import time; the
      // Worker reads the same keys from `cloudflare:workers` env instead.
      { find: '@afilmory/env', replacement: fileURLToPath(new URL('./src/env.ts', import.meta.url)) },
      // T3.1: Apple sign-in is disabled and its table is absent from D1.
      {
        find: '@core/modules/platform/auth/apple-authorization.service',
        replacement: fileURLToPath(new URL('./src/personal-apple-authorization.service.ts', import.meta.url)),
      },
      { find: '@core', replacement: CORE_SRC },
    ],
  },
  // T1.2: the SPA is built by apps/web; every file in its dist becomes a static
  // asset of this Worker.
  publicDir: SPA_DIST,
  build: { copyPublicDir: true },
  plugins: [
    // T0.2 gate: tsyringe relies on `emitDecoratorMetadata`, which esbuild
    // does not emit. SWC does, so the whole `be/apps/core` port depends on
    // this transform staying in the pipeline.
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
    cloudflare(),
  ],
})
