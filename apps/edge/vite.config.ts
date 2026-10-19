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
