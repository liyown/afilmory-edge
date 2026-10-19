import { encodeGatewayState } from '@afilmory/be-utils'
import { describe, expect, it } from 'vitest'

import { createOAuthGatewayApp } from './app'
import type { GatewayConfig } from './config'

const config = {
  host: '0.0.0.0',
  port: 8790,
  baseDomain: 'afilmory.art',
  forceHttps: true,
  callbackBasePath: '/api/auth/callback',
  stateSecret: 'test-gateway-state-secret',
} as const satisfies GatewayConfig

function createState(innerState = 'better-auth-state'): string {
  return encodeGatewayState({
    innerState,
    secret: config.stateSecret,
  })
}

describe('oauth gateway callbacks', () => {
  it('forwards GET callbacks to the site domain and unwraps state in the redirect URL', async () => {
    const app = createOAuthGatewayApp(config)
    const state = createState()
    const response = await app.request(
      `https://auth.afilmory.art/api/auth/callback/github?code=github-code&state=${encodeURIComponent(state)}`,
    )

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin).toBe('https://afilmory.art')
    expect(location.pathname).toBe('/api/auth/callback/github')
    expect(location.searchParams.get('code')).toBe('github-code')
    expect(location.searchParams.get('state')).toBe('better-auth-state')
  })

  it('routes Apple form_post callbacks with a 307 so the browser preserves the authorization body', async () => {
    const app = createOAuthGatewayApp(config)
    const state = createState()
    const form = new URLSearchParams({
      code: 'apple-authorization-code',
      id_token: 'apple-id-token',
      state,
      user: JSON.stringify({ name: { firstName: 'Afilmory' } }),
    })

    const response = await app.request('https://auth.afilmory.art/api/auth/callback/apple', {
      body: form,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    })

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://afilmory.art/api/auth/callback/apple')
  })

  it('rejects a tampered form state instead of forwarding the Apple authorization code', async () => {
    const app = createOAuthGatewayApp(config)
    const state = `${createState()}tampered`
    const form = new URLSearchParams({ code: 'apple-authorization-code', state })

    const response = await app.request('https://auth.afilmory.art/api/auth/callback/apple', {
      body: form,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_state' })
  })

  it('rejects POST callbacks that are not URL-encoded forms', async () => {
    const app = createOAuthGatewayApp(config)
    const response = await app.request('https://auth.afilmory.art/api/auth/callback/apple', {
      body: JSON.stringify({ state: createState() }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(415)
    await expect(response.json()).resolves.toMatchObject({ error: 'unsupported_media_type' })
  })
})
