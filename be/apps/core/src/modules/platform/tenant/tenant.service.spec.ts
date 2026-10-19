import 'reflect-metadata'

import type { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSqliteHarness } from '../../../test-utils/d1-sqlite'
import { TenantRepository } from './tenant.repository'
import { TenantService } from './tenant.service'

vi.mock('@afilmory/db', async () => await import('@afilmory/db/schema.sqlite'))
// The provider module validates the full server environment on import.
vi.mock('@core/database/database.provider', () => ({ DbAccessor: class DbAccessor {} }))

const openDatabases: DatabaseSync[] = []

function createService() {
  const { sqlite, accessor } = createSqliteHarness()
  openDatabases.push(sqlite)
  return { sqlite, service: new TenantService(new TenantRepository(accessor as never)) }
}

afterEach(() => {
  for (const sqlite of openDatabases.splice(0)) {
    sqlite.close()
  }
})

describe('tenantService.ensureRootTenant', () => {
  it('creates one active root tenant on first boot', async () => {
    const { sqlite, service } = createService()

    const first = await service.ensureRootTenant()
    const second = await service.ensureRootTenant()

    expect(first.tenant).toMatchObject({ slug: 'root', status: 'active' })
    expect(second.tenant.id).toBe(first.tenant.id)
    expect(sqlite.prepare('select slug, status from tenant').all()).toEqual([{ slug: 'root', status: 'active' }])
  })

  it('keeps a single row when requests race to create it', async () => {
    const { sqlite, service } = createService()

    const pending: Array<ReturnType<typeof service.ensureRootTenant>> = []
    for (let index = 0; index < 8; index += 1) {
      pending.push(service.ensureRootTenant())
    }
    const results = await Promise.all(pending)

    expect(new Set(results.map(result => result.tenant.id)).size).toBe(1)
    expect(sqlite.prepare('select count(*) as count from tenant').get()).toEqual({ count: 1 })
  })

  it('activates a root tenant left inactive by an older build', async () => {
    const { sqlite, service } = createService()
    sqlite
      .prepare('insert into tenant (id, slug, name, status) values (?, ?, ?, ?)')
      .run('tenant-1', 'root', 'Afilmory', 'inactive')

    const result = await service.ensureRootTenant()

    expect(result.tenant).toMatchObject({ id: 'tenant-1', status: 'active' })
    expect(sqlite.prepare('select status from tenant where id = ?').get('tenant-1')).toEqual({
      status: 'active',
    })
  })
})
