import { resolve } from 'node:path'

import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      reporter: ['text'],
    },
    setupFiles: ['./vitest.setup.ts'],
    maxConcurrency: 1,
  },
  esbuild: false,
  plugins: [tsconfigPaths(), swc.vite()],
  resolve: {
    alias: {
      '@afilmory/env': resolve(import.meta.dirname, 'src/test-utils/env.ts'),
      'cloudflare:workers': resolve(import.meta.dirname, 'src/test-utils/cloudflare-workers.ts'),
    },
  },
})
