import { coreApi } from '~/lib/api-client'
import { camelCaseKeys } from '~/lib/case'

export interface AuthorizeCliRequest {
  name: string
  redirectUri: string
  codeChallenge: string
  state?: string
}

export interface AuthorizeCliResponse {
  code: string
  state: string | null
  expiresAt: string
}

export async function authorizeCli(input: AuthorizeCliRequest): Promise<AuthorizeCliResponse> {
  const response = await coreApi<AuthorizeCliResponse>('/daemon/authorize', {
    method: 'POST',
    body: input,
  })
  return camelCaseKeys<AuthorizeCliResponse>(response)
}
