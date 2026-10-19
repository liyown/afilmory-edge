import process from 'node:process'

const DEFAULTS: Record<string, unknown> = {
  AUTH_GATEWAY_STATE_SECRET: 'test-gateway-state-secret',
  CONFIG_ENCRYPTION_KEY: 'test-config-encryption-key',
  NODE_ENV: 'test',
  TEST: false,
}

/** Node-side stand-in for the Worker binding reader used by vitest. */
export const env = new Proxy({} as Record<string, unknown>, {
  get(_target, key) {
    if (typeof key !== 'string') {
      return undefined
    }
    return process.env[key] ?? DEFAULTS[key]
  },
})
