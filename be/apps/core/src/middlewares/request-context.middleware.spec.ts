import { HttpContext } from '@tsuki-hono/common'
import type { Context } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { RequestContextMiddleware } from './request-context.middleware'

vi.mock('@core/modules/platform/auth/auth.provider', () => ({ AuthProvider: class AuthProvider {} }))
vi.mock('@core/database/database.provider', () => ({ DbAccessor: class DbAccessor {} }))

function createMiddleware(session: unknown = null) {
  const getSession = vi.fn(async () => session)
  const getAuth = vi.fn(async () => ({ api: { getSession } }))
  const resolveBearer = vi.fn(async () => null)
  const middleware = new RequestContextMiddleware({ getAuth } as never, { resolveBearer } as never)
  return { middleware, getSession, resolveBearer }
}

function requestContext(path: string, authorization?: string): Context {
  return {
    req: {
      header: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : undefined),
      method: 'GET',
      path,
      raw: new Request(`https://example.com${path}`),
    },
  } as unknown as Context
}

describe('requestContextMiddleware', () => {
  it('assigns the resolved auth session to the HTTP context', async () => {
    const session = {
      user: { id: 'user-1', role: 'superadmin' },
      session: { id: 'session-1' },
    }
    const { middleware } = createMiddleware(session)
    const context = requestContext('/photos')

    await HttpContext.run(context as never, async () => {
      await middleware.use(context, async () => {})
      expect(HttpContext.getValue('auth')).toEqual(session)
    })
  })

  it('leaves the auth context empty without a session', async () => {
    const { middleware } = createMiddleware()
    const context = requestContext('/photos')

    await HttpContext.run(context as never, async () => {
      await middleware.use(context, async () => {})
      expect(HttpContext.getValue('auth')).toBeUndefined()
    })
  })

  it('resolves a bearer token without consulting the session', async () => {
    const authContext = {
      user: { id: 'user-1', role: 'superadmin' },
      session: { id: 'daemon-token-1' },
    }
    const getSession = vi.fn(async () => null)
    const resolveBearer = vi.fn(async () => authContext)
    const middleware = new RequestContextMiddleware(
      { getAuth: vi.fn(async () => ({ api: { getSession } })) } as never,
      { resolveBearer } as never,
    )
    const context = requestContext('/photos', 'Bearer afi_token')

    await HttpContext.run(context as never, async () => {
      await middleware.use(context, async () => {})
      expect(resolveBearer).toHaveBeenCalledWith('afi_token')
      expect(getSession).not.toHaveBeenCalled()
      expect(HttpContext.getValue('auth')).toEqual(authContext)
    })
  })
})
