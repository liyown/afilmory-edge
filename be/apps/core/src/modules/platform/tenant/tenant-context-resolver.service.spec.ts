import 'reflect-metadata'

import { HttpContext } from '@tsuki-hono/common'
import type { Context } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { requireTenantContext } from './tenant.context'
import type { TenantAggregate, TenantContext } from './tenant.types'
import { TenantContextResolver } from './tenant-context-resolver.service'

vi.mock('@afilmory/db', async () => await import('@afilmory/db/schema.sqlite'))
vi.mock('@core/database/database.provider', () => ({ DbAccessor: class DbAccessor {} }))

function rootAggregate(): TenantAggregate {
  return {
    tenant: {
      id: 'tenant-1',
      slug: 'root',
      name: 'Afilmory',
      planId: 'free',
      status: 'active',
    } as TenantAggregate['tenant'],
  }
}

function createResolver(ensureRootTenant = vi.fn(async () => rootAggregate())) {
  return {
    ensureRootTenant,
    resolver: new TenantContextResolver({ ensureRootTenant } as never),
  }
}

function requestContext(path = '/photos/photo-1'): Context {
  return {
    req: {
      header: () => 'unknown.example.com',
      method: 'GET',
      path,
      raw: new Request(`https://unknown.example.com${path}`),
    },
  } as unknown as Context
}

describe('tenantContextResolver personal shim', () => {
  it('resolves the root tenant for arbitrary hosts and paths', async () => {
    const { ensureRootTenant, resolver } = createResolver()

    const context = await resolver.resolve(requestContext('/tenant/does-not-exist'))

    expect(context).toEqual({
      tenant: expect.objectContaining({ slug: 'root' }),
      isPlaceholder: false,
      requestedSlug: 'root',
    })
    expect(ensureRootTenant).toHaveBeenCalledOnce()
  })

  it('reuses the tenant resolved earlier in the request', async () => {
    const { ensureRootTenant, resolver } = createResolver()
    const existing: TenantContext = { tenant: { id: 'tenant-1' } as TenantContext['tenant'] }

    await HttpContext.run({} as never, async () => {
      HttpContext.setValue('tenant', existing)
      expect(await resolver.resolve(requestContext())).toBe(existing)
    })

    expect(ensureRootTenant).not.toHaveBeenCalled()
  })

  it('caches the ensured tenant across requests', async () => {
    const { ensureRootTenant, resolver } = createResolver()

    const first = await resolver.resolve(requestContext())
    const second = await resolver.resolve(requestContext('/photos/photo-2'))

    expect(second).toBe(first)
    expect(ensureRootTenant).toHaveBeenCalledOnce()
  })

  it('retries after a failed resolution', async () => {
    const ensureRootTenant = vi
      .fn<() => Promise<TenantAggregate>>()
      .mockRejectedValueOnce(new Error('D1 unavailable'))
      .mockResolvedValueOnce(rootAggregate())
    const { resolver } = createResolver(ensureRootTenant)

    await expect(resolver.resolve(requestContext())).rejects.toThrow('D1 unavailable')
    await expect(resolver.resolve(requestContext())).resolves.toMatchObject({
      tenant: expect.objectContaining({ slug: 'root' }),
    })
  })

  it('ensures the root tenant during module initialization', async () => {
    const { ensureRootTenant, resolver } = createResolver()

    await resolver.onModuleInit()

    expect(ensureRootTenant).toHaveBeenCalledOnce()
  })

  it('makes requireTenantContext available inside a request', async () => {
    const { resolver } = createResolver()

    await HttpContext.run({} as never, async () => {
      const context = await resolver.resolve(requestContext())
      HttpContext.setValue('tenant', context)

      expect(requireTenantContext().tenant.slug).toBe('root')
    })
  })
})
