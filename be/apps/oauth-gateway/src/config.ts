import process from 'node:process'

import { z } from 'zod'

const HOSTNAME_PATTERN = /^[a-z0-9.-]+$/i
const TRAILING_SLASHES = /\/+$/

const booleanSchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value
    }
    if (value === undefined) {
      return
    }
    const normalized = value.trim().toLowerCase()
    return !['false', '0', 'no', 'off'].includes(normalized)
  })

const envSchema = z.object({
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8790),
  BASE_DOMAIN: z
    .string({ error: 'AUTH_GATEWAY_BASE_DOMAIN is required.' })
    .trim()
    .min(1, { message: 'AUTH_GATEWAY_BASE_DOMAIN is required.' })
    .regex(HOSTNAME_PATTERN, { message: 'BASE_DOMAIN must be a valid hostname.' }),
  FORCE_HTTPS: booleanSchema.default(true),
  CALLBACK_BASE_PATH: z
    .string()
    .trim()
    .default('/api/auth/callback')
    .transform(value => value.replace(TRAILING_SLASHES, '') || '/api/auth/callback'),

  STATE_SECRET: z
    .string()
    .trim()
    .min(1, { message: 'AUTH_GATEWAY_STATE_SECRET or CONFIG_ENCRYPTION_KEY is required for state decoding.' }),
})

const resolvedStateSecret = process.env.AUTH_GATEWAY_STATE_SECRET ?? process.env.CONFIG_ENCRYPTION_KEY
if (!resolvedStateSecret) {
  throw new Error(
    '[oauth-gateway] AUTH_GATEWAY_STATE_SECRET (or CONFIG_ENCRYPTION_KEY) is required to decode OAuth state.',
  )
}

const parsed = envSchema.parse({
  HOST: process.env.AUTH_GATEWAY_HOST ?? process.env.HOST,
  PORT: process.env.AUTH_GATEWAY_PORT ?? process.env.PORT,
  BASE_DOMAIN: process.env.AUTH_GATEWAY_BASE_DOMAIN,
  FORCE_HTTPS: process.env.AUTH_GATEWAY_FORCE_HTTPS,
  CALLBACK_BASE_PATH: process.env.AUTH_GATEWAY_CALLBACK_BASE_PATH,
  ALLOW_CUSTOM_HOST: process.env.AUTH_GATEWAY_ALLOW_CUSTOM_HOST,
  STATE_SECRET: resolvedStateSecret,
})

export const gatewayConfig = {
  host: parsed.HOST,
  port: parsed.PORT,
  baseDomain: parsed.BASE_DOMAIN.toLowerCase(),
  forceHttps: Boolean(parsed.FORCE_HTTPS),
  callbackBasePath: parsed.CALLBACK_BASE_PATH,
  stateSecret: parsed.STATE_SECRET,
} as const

export type GatewayConfig = typeof gatewayConfig
