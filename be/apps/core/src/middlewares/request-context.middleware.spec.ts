import { HttpContext } from '@tsuki-hono/common'
import type { Context } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { RequestContextMiddleware } from './request-context.middleware'

vi.mock('@core/modules/platform/auth/auth.provider', () => ({ AuthProvider: class AuthProvider {} }))
vi.mock('@core/database/database.provider', () => ({ DbAccessor: class DbAccessor {} }))

function createMiddleware(session: unknown = null) {
  const getSession = vi.fn(async () => session)
  const getAuth = vi.fn(async () => ({ api: { getSession } }))
  const middleware = new RequestContextMiddleware({ getAuth } as never)
  return { middleware, getSession }
}

function requestContext(path: string): Context {
  return {
    req: {
      header: () => undefined,
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
})
