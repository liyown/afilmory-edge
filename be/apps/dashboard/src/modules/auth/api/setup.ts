import { coreApi } from '~/lib/api-client'
import { camelCaseKeys } from '~/lib/case'

export interface SetupStatus {
  needsSetup: boolean
  setupEnabled: boolean
}

export interface CreateOwnerInput {
  token: string
  email: string
  name?: string
  password: string
}

export const SETUP_STATUS_QUERY_KEY = ['setup', 'status'] as const

export async function fetchSetupStatus(): Promise<SetupStatus> {
  return camelCaseKeys<SetupStatus>(await coreApi<SetupStatus>('/setup/status', { method: 'GET' }))
}

export async function createOwner(input: CreateOwnerInput): Promise<void> {
  await coreApi('/setup/owner', { method: 'POST', body: input })
}
