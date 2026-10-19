import { fileURLToPath } from 'node:url'

import { cloudflare } from '@cloudflare/vite-plugin'
import swc from 'unplugin-swc'
import { defineConfig } from 'vite'

// Single Worker = one assets root. Both SPAs build into this tree:
//   apps/web       -> apps/edge/public
//   dashboard      -> apps/edge/public/dashboard
const SPA_DIST = new URL('./public/', import.meta.url).pathname
const CORE_SRC = fileURLToPath(new URL('../../be/apps/core/src/', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [{ find: '@core', replacement: CORE_SRC }],
  },
  // The SPA is built by apps/web; every file in its dist becomes a static
  // asset of this Worker.
  publicDir: SPA_DIST,
  build: { copyPublicDir: true },
  plugins: [
    // tsyringe relies on `emitDecoratorMetadata`, which esbuild does not emit.
    // SWC does, so the whole `be/apps/core` graph depends on this transform
    // staying in the pipeline.
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
