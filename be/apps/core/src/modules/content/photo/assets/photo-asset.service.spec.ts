import type { DatabaseSync } from 'node:sqlite'

import { HttpContext } from '@tsuki-hono/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSqliteHarness, seedTenant } from '../../../../test-utils/d1-sqlite'
import { ManifestSyncService } from '../../manifest-sync/manifest-sync.service'
import { PhotoAssetService } from './photo-asset.service'

vi.mock('@afilmory/db', async () => await import('@afilmory/db/schema.sqlite'))
vi.mock('@core/database/database.provider', () => ({ DbAccessor: class DbAccessor {} }))
vi.mock('@afilmory/env', () => ({ env: {} }))

const openDatabases: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of openDatabases.splice(0)) {
    sqlite.close()
  }
})

function createService(accessor: unknown) {
  const manifestSyncService = new ManifestSyncService(accessor as never, { emit: vi.fn() } as never)
  const billingUsageService = { recordEvent: vi.fn() }

  const service = new PhotoAssetService(
    accessor as never,
    {} as never,
    {} as never,
    {} as never,
    billingUsageService as never,
    {} as never,
    {} as never,
    {} as never,
    manifestSyncService,
  )

  return { service, billingUsageService }
}

function insertAsset(sqlite: DatabaseSync, tenantId: string, assetId: string) {
  const now = new Date().toISOString()
  sqlite
    .prepare(
      `insert into photo_asset
        (id, tenant_id, photo_id, storage_key, storage_provider, manifest, sync_status, synced_at, created_at, updated_at)
       values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .run(
      assetId,
      tenantId,
      `photo-${assetId}`,
      `photos/${assetId}.jpg`,
      's3',
      '{"version":"1","data":{}}',
      'synced',
      now,
      now,
      now,
    )
}

function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return HttpContext.run({} as never, async () => {
    HttpContext.assign({ tenant: { tenant: { id: tenantId } } } as never)
    return await fn()
  })
}

describe('photoAssetService delete transaction', () => {
  it('deletes assets and records manifest changes atomically', async () => {
    const { sqlite, accessor } = createSqliteHarness()
    openDatabases.push(sqlite)
    seedTenant(sqlite, 'tenant-1')
    insertAsset(sqlite, 'tenant-1', 'asset-1')
    const { service, billingUsageService } = createService(accessor)

    const changes = await withTenant('tenant-1', () => service.deleteAssets(['asset-1']))

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ revision: 1, operation: 'delete', photoId: 'photo-asset-1' })
    expect(sqlite.prepare('select count(*) as count from photo_asset').get()).toMatchObject({ count: 0 })
    expect(billingUsageService.recordEvent).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when the same assets are deleted twice', async () => {
    const { sqlite, accessor } = createSqliteHarness()
    openDatabases.push(sqlite)
    seedTenant(sqlite, 'tenant-1')
    insertAsset(sqlite, 'tenant-1', 'asset-1')
    const { service, billingUsageService } = createService(accessor)

    await withTenant('tenant-1', () => service.deleteAssets(['asset-1']))
    const second = await withTenant('tenant-1', () => service.deleteAssets(['asset-1']))

    expect(second).toEqual([])
    expect(sqlite.prepare('select count(*) as count from tenant_manifest_change').get()).toMatchObject({ count: 1 })
    expect(billingUsageService.recordEvent).toHaveBeenCalledTimes(1)
  })
})
