import { coreApi } from '~/lib/api-client'

import type { BetterAuthUserRole } from '../types'

export type DashboardUser = {
  id: string
  name: string | null
  email: string
  image: string | null
  role: BetterAuthUserRole
  createdAt: string
  lastSignedInAt: string | null
  banned: boolean
}

export const DASHBOARD_USERS_QUERY_KEY = ['auth', 'users'] as const

export async function listDashboardUsers(): Promise<DashboardUser[]> {
  const { users } = await coreApi<{ users: DashboardUser[] }>('/auth/users')
  return users
}

export async function updateDashboardUserRole(id: string, role: 'user' | 'admin'): Promise<void> {
  await coreApi(`/auth/users/${encodeURIComponent(id)}/role`, {
    method: 'POST',
    body: { role },
  })
}
