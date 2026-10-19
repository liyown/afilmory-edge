import { env as workerEnv } from 'cloudflare:workers'

export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'production'
  TEST: boolean
  CONFIG_ENCRYPTION_KEY: string
  BETTER_AUTH_SECRET?: string
  AUTH_GATEWAY_STATE_SECRET?: string
  APPLE_WEB_CLIENT_ID?: string
  APPLE_TEAM_ID?: string
  APPLE_KEY_ID?: string
  APPLE_PRIVATE_KEY?: string
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET_NAME?: string
  R2_PUBLIC_BASE_URL?: string
  OG_THUMBNAIL_ORIGIN?: string
}

const DEFAULTS: Partial<Record<keyof AppEnv, unknown>> = {
  NODE_ENV: 'development',
  TEST: false,
}

const BOOLEAN_KEYS = new Set<keyof AppEnv>(['TEST'])

const bindings = workerEnv as unknown as Record<string, unknown>

function readValue(key: keyof AppEnv): unknown {
  const raw = bindings[key]
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULTS[key]
  }

  if (BOOLEAN_KEYS.has(key)) {
    return raw === true || raw === 'true'
  }

  return raw
}

/**
 * Worker configuration. Reads Cloudflare bindings lazily so the module can be
 * imported before the first request has been dispatched.
 */
export const env = new Proxy({} as AppEnv, {
  get(_target, key) {
    if (typeof key !== 'string') {
      return undefined
    }
    return readValue(key as keyof AppEnv)
  },
})

export type NodeEnv = AppEnv['NODE_ENV']
