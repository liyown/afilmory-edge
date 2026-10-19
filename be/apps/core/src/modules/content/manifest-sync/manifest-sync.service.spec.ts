import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSqliteHarness } from '../../../test-utils/d1-sqlite'
import type { ManifestChangeDraft } from './manifest-sync.service'
import { ManifestSyncService } from './manifest-sync.service'

// The provider module validates the full server environment on import; the
// service only needs the DI token for its constructor metadata.
vi.mock('@core/database/database.provider', () => ({ DbAccessor: class DbAccessor {} }))

function createService(accessor: unknown) {
  const emit = vi.fn()
  const service = new ManifestSyncService(accessor as never, { emit } as never)
  return { service, emit }
}

function readRevision(sqlite: DatabaseSync) {
  return (
    sqlite.prepare('select revision from manifest_state where id = ?1').get('default') as
      { revision: number } | undefined
  )?.revision
}

function readChanges(sqlite: DatabaseSync) {
  return sqlite.prepare('select revision, photo_id from manifest_change order by revision').all() as Array<{
    revision: number
    photo_id: string
  }>
}

function deleteDraft(photoId: string): ManifestChangeDraft {
  return { operation: 'delete', photoId, assetId: `asset-${photoId}` }
}

const openDatabases: DatabaseSync[] = []
const tempDirectories: string[] = []

function openDatabase(filename = ':memory:', migrate = true) {
  const harness = createSqliteHarness({ filename, migrate })
  openDatabases.push(harness.sqlite)
  return harness
}

afterEach(() => {
  for (const sqlite of openDatabases.splice(0)) {
    sqlite.close()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('manifestSyncService atomic draft recording', () => {
  it('allocates contiguous revisions across repeated calls', async () => {
    const { sqlite, accessor } = openDatabase()
    const { service } = createService(accessor)

    const first = await service.recordDrafts([deleteDraft('a'), deleteDraft('b')])
    expect(first.map(change => change.revision)).toEqual([1, 2])

    const second = await service.recordDrafts([deleteDraft('c')])
    expect(second.map(change => change.revision)).toEqual([3])

    expect(readRevision(sqlite)).toBe(3)
    expect(readChanges(sqlite)).toEqual([
      { revision: 1, photo_id: 'a' },
      { revision: 2, photo_id: 'b' },
      { revision: 3, photo_id: 'c' },
    ])
  })

  it('keeps revisions unique when two workers record drafts concurrently', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'afilmory-manifest-'))
    tempDirectories.push(directory)
    const filename = path.join(directory, 'manifest.sqlite')

    const firstDatabase = openDatabase(filename)
    const secondDatabase = openDatabase(filename, false)

    const first = createService(firstDatabase.accessor).service
    const second = createService(secondDatabase.accessor).service

    const [firstChange] = await Promise.all([
      first.recordDrafts([deleteDraft('a')]),
      second.recordDrafts([deleteDraft('b')]),
    ])

    const revisions = readChanges(firstDatabase.sqlite).map(row => row.revision)
    expect(revisions).toEqual([1, 2])
    expect(await first.getRevision()).toBe(2)
    expect(firstChange).toHaveLength(1)
  })

  it('prunes changes older than the retention window', async () => {
    const { sqlite, accessor } = openDatabase()
    const { service } = createService(accessor)
    const now = new Date().toISOString()

    sqlite
      .prepare('insert into manifest_state (id, revision, updated_at) values (?1, ?2, ?3)')
      .run('default', 10_000, now)
    sqlite
      .prepare(
        'insert into manifest_change (revision, operation, photo_id, payload, created_at) values (?1, ?2, ?3, ?4, ?5)',
      )
      .run(1, 'delete', 'old', '{}', now)

    const [change] = await service.recordDrafts([deleteDraft('new')])

    expect(change.revision).toBe(10_001)
    expect(readChanges(sqlite)).toEqual([{ revision: 10_001, photo_id: 'new' }])
  })
})
