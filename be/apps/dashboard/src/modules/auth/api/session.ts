import { coreApi } from '~/lib/api-client'
import { camelCaseKeys } from '~/lib/case'

import type { BetterAuthSession, BetterAuthUser } from '../types'

export type SessionResponse = {
  user: BetterAuthUser
  session: BetterAuthSession
}

export const AUTH_SESSION_QUERY_KEY = ['auth', 'session'] as const

export async function fetchSession(): Promise<SessionResponse | null> {
  const session = await coreApi<SessionResponse | null>('/auth/session', { method: 'GET' })
  return session ? camelCaseKeys<SessionResponse>(session) : null
}
