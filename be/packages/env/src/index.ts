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
  S3_ENDPOINT?: string
  S3_REGION?: string
  S3_ACCESS_KEY_ID?: string
  S3_SECRET_ACCESS_KEY?: string
  // Native R2 binding used by the one-click deployment.
  PHOTOS?: unknown
  STORAGE_DRIVER?: 's3' | 'r2'
  // Required for the first-run owner setup flow; absent on existing installs.
  SETUP_TOKEN?: string
  DB?: unknown
  AI?: AiBinding
  VECTORIZE?: VectorizeBinding
  AI_VISION_MODEL?: string
  AI_EMBEDDING_MODEL?: string
  AI_INDEX_ENABLED?: string
}

export interface AiBinding {
  run: (model: string, input: unknown) => Promise<unknown>
}

export interface VectorizeVector {
  id: string
  values: number[]
  metadata?: Record<string, unknown>
}

export interface VectorizeQueryMatch {
  id: string
  score: number
  metadata?: Record<string, unknown>
}

export interface VectorizeBinding {
  upsert: (vectors: VectorizeVector[]) => Promise<unknown>
  query: (values: number[], options?: Record<string, unknown>) => Promise<{ matches: VectorizeQueryMatch[] }>
  deleteByIds: (ids: string[]) => Promise<unknown>
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
