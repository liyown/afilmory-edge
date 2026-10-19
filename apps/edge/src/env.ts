import { env as workerEnv } from 'cloudflare:workers'

import type { env as NodeEnv } from '../../../be/packages/env/src/index'

type NodeEnvShape = typeof NodeEnv

const workerBindings = workerEnv as unknown as Record<string, unknown>

// `@afilmory/env` validates `process.env` with zod, which cannot run in workerd.
// The Worker reads the same keys from bindings lazily, keeping the node defaults
// that core code relies on when a binding is absent.
const defaults: Partial<Record<keyof NodeEnvShape, unknown>> = {
  NODE_ENV: 'development',
  PORT: 3000,
  WS_PORT: 3001,
  HOSTNAME: '0.0.0.0',
  DATABASE_URL: 'd1://afilmory',
  REDIS_URL: 'redis://in-process',
  APP_STORE_BUNDLE_ID: 'app.afilmory',
  APP_STORE_ENABLE_ONLINE_CHECKS: true,
  RESEND_FROM: 'AFILMORY <notification@afilmory.art>',
  MOBILE_STORAGE_HANDOFF_RETURN_URL: 'afilmory://onboarding/storage',
  DEFAULT_SUPERADMIN_EMAIL: 'root@local.host',
  DEFAULT_SUPERADMIN_USERNAME: 'root',
  PERSONAL_DEPLOYMENT: true,
  TEST: false,
}

const booleanKeys = new Set<keyof NodeEnvShape>(['APP_STORE_ENABLE_ONLINE_CHECKS', 'PERSONAL_DEPLOYMENT', 'TEST'])

function readValue(key: keyof NodeEnvShape): unknown {
  const raw = workerBindings[key]
  if (raw === undefined || raw === null || raw === '') {
    return defaults[key]
  }

  if (booleanKeys.has(key)) {
    return raw === true || raw === 'true'
  }

  return raw
}

export const env = new Proxy({} as NodeEnvShape, {
  get(_target, key) {
    if (typeof key !== 'string') {
      return undefined
    }
    return readValue(key as keyof NodeEnvShape)
  },
})
