import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import type { D1Statement } from './lib/d1-target'
import { createHttpD1Target, createSqliteTarget, seedPersonalTenant } from './lib/d1-target'
import type { SourceTables } from './migrate-pg-to-d1'
import { migrateSourceToTarget, TABLE_SPECS, verifyMigration } from './migrate-pg-to-d1'

const NOW = '2026-10-19T00:00:00.000Z'
const MIGRATION_SQL = readFileSync(
  new URL('../../../packages/db/migrations-sqlite/0000_heavy_skin.sql', import.meta.url),
  'utf8',
)

function makeRow(table: string, overrides: Record<string, unknown>): Record<string, unknown> {
  const spec = TABLE_SPECS.find(entry => entry.name === table)
  if (!spec) {
    throw new Error(`Unknown table ${table}`)
  }
  const base = Object.fromEntries(spec.columns.map(([name]) => [name, null]))
  return { ...base, ...overrides }
}

function createSource(): SourceTables {
  return {
    tenant: [
      makeRow('tenant', {
        id: 't1',
        slug: 'root',
        name: 'Afilmory',
        plan_id: 'free',
        banned: false,
        status: 'active',
        created_at: NOW,
        updated_at: NOW,
      }),
    ],
    auth_user: [
      makeRow('auth_user', {
        id: 'u1',
        name: 'Admin',
        email: 'admin@example.com',
        email_verified: true,
        had_trial: false,
        role: 'superadmin',
        two_factor_enabled: false,
        banned: false,
        created_at: NOW,
        updated_at: NOW,
      }),
    ],
    tenant_membership: [
      makeRow('tenant_membership', {
        id: 'm1',
        tenant_id: 't1',
        user_id: 'u1',
        role: 'owner',
        status: 'active',
        created_at: NOW,
        updated_at: NOW,
      }),
    ],
    auth_session: [
      makeRow('auth_session', {
        id: 's1',
        expires_at: NOW,
        token: 'session-token',
        created_at: NOW,
        updated_at: NOW,
        active_tenant_id: 't1',
        user_id: 'u1',
      }),
    ],
    auth_account: [
      makeRow('auth_account', {
        id: 'a1',
        account_id: 'u1',
        provider_id: 'credential',
        user_id: 'u1',
        password: 'hashed',
        created_at: NOW,
        updated_at: NOW,
      }),
    ],
    auth_verification: [
      makeRow('auth_verification', {
        id: 'v1',
        identifier: 'admin@example.com',
        value: 'code',
        expires_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      }),
    ],
    settings: [
      makeRow('settings', {
        id: 'set1',
        tenant_id: 't1',
        key: 'storage',
        value: '{"bucket":"photos"}',
        is_sensitive: false,
        created_at: NOW,
        updated_at: NOW,
      }),
    ],
    system_setting: [
      makeRow('system_setting', {
        id: 'ss1',
        key: 'oauth_gateway_url',
        value: { url: 'https://auth.example.com' },
        is_sensitive: false,
        created_at: NOW,
        updated_at: NOW,
      }),
    ],
    photo_asset: [
      makeRow('photo_asset', {
        id: 'p1',
        tenant_id: 't1',
        photo_id: 'photo-1',
        storage_key: 'photos/p1.jpg',
        storage_provider: 's3',
        size: '12345',
        manifest_version: 'v10',
        manifest: { version: 'v10', data: { id: 'photo-1' } },
        sync_status: 'synced',
        conflict_payload: null,
        last_modified: '2026-10-18 12:30:00',
        synced_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      }),
    ],
    photo_sync_run: [
      makeRow('photo_sync_run', {
        id: 'run1',
        tenant_id: 't1',
        dry_run: true,
        summary: { inserted: 1, updated: 0, deleted: 0 },
        actions_count: 1,
        started_at: NOW,
        completed_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      }),
    ],
    tenant_manifest_state: [
      makeRow('tenant_manifest_state', {
        tenant_id: 't1',
        revision: '2',
        updated_at: NOW,
      }),
    ],
    tenant_manifest_change: [
      makeRow('tenant_manifest_change', {
        tenant_id: 't1',
        revision: '2',
        operation: 'upsert',
        photo_id: 'photo-1',
        payload: { operation: 'upsert', photoId: 'photo-1', asset: null },
        created_at: NOW,
      }),
    ],
    reactions: [
      makeRow('reactions', {
        id: 're1',
        tenant_id: 't1',
        ref_key: 'photo-1',
        reaction: 'like',
        created_at: NOW,
      }),
    ],
    // Child first: migration must topologically sort the self reference.
    comment: [
      makeRow('comment', {
        id: 'c2',
        tenant_id: 't1',
        photo_id: 'photo-1',
        user_id: 'u1',
        parent_id: 'c1',
        content: 'reply',
        status: 'approved',
        created_at: NOW,
        updated_at: NOW,
      }),
      makeRow('comment', {
        id: 'c1',
        tenant_id: 't1',
        photo_id: 'photo-1',
        user_id: 'u1',
        parent_id: null,
        content: 'root',
        status: 'approved',
        created_at: NOW,
        updated_at: NOW,
      }),
    ],
    comment_reaction: [
      makeRow('comment_reaction', {
        id: 'cr1',
        tenant_id: 't1',
        comment_id: 'c2',
        user_id: 'u1',
        reaction: 'like',
        created_at: NOW,
      }),
    ],
  }
}

function createTarget() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('pragma foreign_keys = on')
  sqlite.exec(MIGRATION_SQL)
  return { sqlite, target: createSqliteTarget(sqlite) }
}

function countRows(sqlite: DatabaseSync, table: string): number {
  const row = sqlite.prepare(`select count(*) as count from "${table}"`).get() as { count: number }
  return row.count
}

describe('migrateSourceToTarget', () => {
  it('normalizes PG values and preserves foreign-key order', async () => {
    const { sqlite, target } = createTarget()

    const migrations = await migrateSourceToTarget(createSource(), target, { batchSize: 2 })

    expect(migrations.find(migration => migration.table === 'comment')).toMatchObject({
      rows: 2,
      batches: 1,
    })
    expect(countRows(sqlite, 'tenant')).toBe(1)
    expect(countRows(sqlite, 'comment')).toBe(2)
    expect(countRows(sqlite, 'comment_reaction')).toBe(1)

    expect(sqlite.prepare('select id from comment order by rowid').all()).toEqual([{ id: 'c1' }, { id: 'c2' }])
    expect(sqlite.prepare('select email_verified, banned from auth_user').get()).toEqual({
      email_verified: 1,
      banned: 0,
    })
    expect(sqlite.prepare('select size from photo_asset').get()).toEqual({ size: 12345 })
    expect(sqlite.prepare('select revision from tenant_manifest_state').get()).toEqual({ revision: 2 })
    expect(sqlite.prepare('select last_modified from photo_asset').get()).toEqual({
      last_modified: '2026-10-18T12:30:00Z',
    })

    const manifest = sqlite.prepare('select manifest from photo_asset').get() as { manifest: string }
    expect(JSON.parse(manifest.manifest)).toEqual({ version: 'v10', data: { id: 'photo-1' } })
  })

  it('is idempotent across reruns', async () => {
    const { sqlite, target } = createTarget()
    const source = createSource()

    await migrateSourceToTarget(source, target, { batchSize: 2 })
    await migrateSourceToTarget(source, target, { batchSize: 2 })

    for (const spec of TABLE_SPECS) {
      expect(countRows(sqlite, spec.name)).toBe(source[spec.name]?.length ?? 0)
    }
  })

  it('reconciles counts and sampled JSON values', async () => {
    const { target } = createTarget()
    const source = createSource()
    await migrateSourceToTarget(source, target)

    const report = await verifyMigration(source, target)

    expect(report.countMismatches).toEqual([])
    expect(report.sampleMismatches).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.sampled).toBeGreaterThan(10)
  })
})

describe('seedPersonalTenant', () => {
  it('seeds a personal tenant, admin, membership and manifest state once', async () => {
    const { sqlite, target } = createTarget()

    const first = await seedPersonalTenant(target, {
      adminEmail: 'owner@example.com',
      adminName: 'Owner',
      now: NOW,
      slug: 'root',
      tenantName: 'Afilmory',
    })

    expect(first).toMatchObject({
      createdMembership: true,
      createdTenant: true,
      createdUser: true,
    })
    expect(countRows(sqlite, 'tenant')).toBe(1)
    expect(countRows(sqlite, 'auth_user')).toBe(1)
    expect(countRows(sqlite, 'tenant_membership')).toBe(1)
    expect(countRows(sqlite, 'tenant_manifest_state')).toBe(1)
    expect(sqlite.prepare('select role, email_verified from auth_user').get()).toEqual({
      role: 'superadmin',
      email_verified: 1,
    })
    expect(sqlite.prepare('select role, status from tenant_membership').get()).toEqual({
      role: 'owner',
      status: 'active',
    })

    const second = await seedPersonalTenant(target, {
      adminEmail: 'OWNER@example.com',
      now: NOW,
      slug: 'root',
    })

    expect(second).toMatchObject({
      createdMembership: false,
      createdTenant: false,
      createdUser: false,
      tenantId: first.tenantId,
      userId: first.userId,
    })
    expect(countRows(sqlite, 'tenant')).toBe(1)
    expect(countRows(sqlite, 'auth_user')).toBe(1)
    expect(countRows(sqlite, 'tenant_membership')).toBe(1)
  })
})

describe('createHttpD1Target', () => {
  it('sends a batch in the D1 REST API shape', async () => {
    const statements: D1Statement[] = [
      { sql: 'insert into "tenant" ("id") values (?)', params: ['t1'] },
      { sql: 'insert into "tenant" ("id") values (?)', params: ['t2'] },
    ]
    const fetchImpl = vi.fn(async () =>
      Response.json({ result: [{ success: true }, { success: true }], success: true }))
    const target = createHttpD1Target({
      accountId: 'account',
      apiToken: 'token',
      databaseId: 'database',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await target.batch(statements)

    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/account/d1/database/database/query')
    expect(init.headers).toMatchObject({ authorization: 'Bearer token' })
    expect(JSON.parse(String(init.body))).toEqual({ batch: statements })
  })

  it('surfaces statement failures from the D1 REST API', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ result: [{ error: 'no such table: tenant', success: false }], success: true }))
    const target = createHttpD1Target({
      accountId: 'account',
      apiToken: 'token',
      databaseId: 'database',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await expect(target.batch([{ sql: 'select 1', params: [] }])).rejects.toThrow('no such table: tenant')
  })
})
