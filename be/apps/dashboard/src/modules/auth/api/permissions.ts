import { coreApi } from '~/lib/api-client'

type PermissionResponse = {
  allowed: boolean
}

export async function checkDashboardAccess(): Promise<PermissionResponse> {
  return coreApi<PermissionResponse>('/auth/permissions/dashboard', { method: 'GET' })
}
