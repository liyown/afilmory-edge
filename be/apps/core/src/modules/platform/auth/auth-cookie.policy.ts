import type { BetterAuthOptions } from 'better-auth'

export const AUTH_COOKIE_PREFIX = 'afilmory'

// Browser credentials are host-only. Better Auth omits the Domain attribute
// when cross-subdomain cookies are disabled, which keeps sessions isolated to
// the exact host that created them.
export const AUTH_COOKIE_POLICY = {
  cookiePrefix: AUTH_COOKIE_PREFIX,
  crossSubDomainCookies: { enabled: false },
} as const satisfies NonNullable<BetterAuthOptions['advanced']>
