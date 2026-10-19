import { requireTenantContext } from '@core/modules/platform/tenant/tenant.context'
import { HttpContext } from '@tsuki-hono/common'
import type { Context } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { RequestContextMiddleware } from './request-context.middleware'

vi.mock('@core/modules/platform/auth/auth.provider', () => ({ AuthProvider: class AuthProvider {} }))
vi.mock('@afilmory/db', async () => await import('@afilmory/db/schema.sqlite'))
vi.mock('@core/database/database.provider', () => ({ DbAccessor: class DbAccessor {} }))

const ROOT_TENANT_CONTEXT = {
  tenant: { id: 'tenant-1', slug: 'root' },
  isPlaceholder: false,
  requestedSlug: 'root',
}

function createMiddleware() {
  const resolve = vi.fn(async () => ROOT_TENANT_CONTEXT)
  const getSession = vi.fn(async () => null)
  const getAuth = vi.fn(async () => ({ api: { getSession } }))
  const middleware = new RequestContextMiddleware({ resolve } as never, { getAuth } as never)
  return { middleware, resolve }
}

function requestContext(path: string): Context {
  return {
    req: {
      header: () => undefined,
      method: 'GET',
      path,
      raw: new Request(`https://unknown.example.com${path}`),
    },
  } as unknown as Context
}

describe('requestContextMiddleware tenant shim', () => {
  it('provides the root tenant to every request, regardless of host', async () => {
    const { middleware, resolve } = createMiddleware()
    const context = requestContext('/tenant/does-not-exist')

    let observedSlug: string | undefined

    await HttpContext.run(context as never, async () => {
      await middleware.use(context, async () => {
        observedSlug = requireTenantContext().tenant.slug
      })
    })

    expect(observedSlug).toBe('root')
    expect(resolve).toHaveBeenCalledWith(context, {
      throwOnMissing: false,
      skipInitializationCheck: true,
    })
  })
})
