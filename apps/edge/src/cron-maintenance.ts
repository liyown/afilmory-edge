// Storage maintenance shared by the scheduled handler. Kept free of OG
// rendering so it can be exercised outside workerd (no wasm imports).

import type { StorageObjectInfo } from './storage'
import { storageDelete, storageList, storagePut } from './storage'

const PHOTO_PREFIX = 'photos/'
const BACKUP_PREFIX = 'backups/d1/'
const BACKUP_RETENTION = 14
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000

export type CronEnv = Pick<Env, 'ASSETS' | 'DB' | 'CACHE'>

interface PhotoAssetRow {
  storageKey: string
  manifest: string | null
}

export interface CleanupResult {
  scanned: number
  deleted: number
  keys: string[]
}

export interface BackupResult {
  key: string
  tableCount: number
  rowCount: number
  bytes: number
  pruned: number
}

export async function listAll(prefix: string): Promise<StorageObjectInfo[]> {
  return await storageList(prefix)
}

export async function deleteKeys(keys: string[]): Promise<void> {
  await storageDelete(keys)
}

async function referencedPhotoKeys(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare('select "storage_key" as storageKey, "manifest" as manifest from "photo_asset"')
    .all<PhotoAssetRow>()

  const keys = new Set<string>()
  for (const row of results ?? []) {
    if (row.storageKey) {
      keys.add(row.storageKey)
    }
    if (!row.manifest) {
      continue
    }
    try {
      const manifest = JSON.parse(row.manifest) as { data?: { video?: { type?: string; s3Key?: string } } }
      const video = manifest.data?.video
      if (video?.type === 'live-photo' && video.s3Key) {
        keys.add(video.s3Key)
      }
    } catch {
      // A malformed manifest should not stop cleanup; the asset row still
      // keeps its primary object referenced.
    }
  }
  return keys
}

/**
 * An upload intent writes bytes before `upload-complete` runs. When the client
 * disappears in between, the object is never attached to a photo_asset row.
 * Only objects older than the grace window are removed so in-flight uploads
 * survive.
 */
export async function cleanupOrphanUploads(env: CronEnv, now = Date.now()): Promise<CleanupResult> {
  const referenced = await referencedPhotoKeys(env.DB)
  const objects = await listAll(PHOTO_PREFIX)

  const orphans = objects
    .filter(
      (object) =>
        !referenced.has(object.key) &&
        object.uploaded !== undefined &&
        now - object.uploaded.getTime() > ORPHAN_GRACE_MS,
    )
    .map((object) => object.key)

  await deleteKeys(orphans)
  return { scanned: objects.length, deleted: orphans.length, keys: orphans }
}

function backupKey(now: Date): string {
  return `${BACKUP_PREFIX}${now.toISOString().replaceAll(':', '-')}.json.gz`
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return await new Response(stream).arrayBuffer()
}

export async function backupD1(env: CronEnv, now = new Date()): Promise<BackupResult> {
  const { results } = await env.DB.prepare(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
  ).all<{ name: string }>()

  const tables: Record<string, Record<string, unknown>[]> = {}
  let rowCount = 0
  for (const { name } of results ?? []) {
    // D1 exposes internal tables through sqlite_master but rejects reads.
    if (name.startsWith('_cf_')) {
      continue
    }
    const quoted = `"${name.replaceAll('"', '""')}"`
    const rows = await env.DB.prepare(`select * from ${quoted}`).all<Record<string, unknown>>()
    tables[name] = rows.results ?? []
    rowCount += tables[name].length
  }

  const document = JSON.stringify({
    version: 1,
    exportedAt: now.toISOString(),
    tables,
  })
  const body = await gzip(document)
  const key = backupKey(now)
  await storagePut(key, body, {
    contentType: 'application/gzip',
    cacheControl: 'private, max-age=0',
    metadata: { rowCount: String(rowCount), tableCount: String(Object.keys(tables).length) },
  })
  await env.CACHE.put('backup:last', key)

  const backups = (await listAll(BACKUP_PREFIX))
    .map((object) => object.key)
    .sort()
    .reverse()
  const stale = backups.slice(BACKUP_RETENTION)
  await deleteKeys(stale)

  return {
    key,
    tableCount: Object.keys(tables).length,
    rowCount,
    bytes: body.byteLength,
    pruned: stale.length,
  }
}
