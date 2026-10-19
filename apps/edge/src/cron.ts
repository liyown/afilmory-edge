// Phase 7 scheduled work:
// - hourly: delete R2 objects left behind by interrupted uploads, refresh the
//   OG image cache, and drop OG entries for photos that no longer exist;
// - daily: export every D1 table into a gzipped JSON document in R2.
//
// Both tasks are idempotent, so a retried cron invocation is safe.

import type { CronEnv } from './cron-maintenance'
import { backupD1, cleanupOrphanUploads, deleteKeys, listAll } from './cron-maintenance'
import { loadManifest } from './html'
import { renderOgImage } from './og'

// Keep both literals in sync with cloudflare.config.ts (the dev server cannot
// import Worker source from the config module).
export const HOURLY_CRON = '0 * * * *'
export const DAILY_BACKUP_CRON = '30 2 * * *'

const OG_PREFIX = 'og/'
const MAX_OG_PER_RUN = 50
const OG_CACHE_CONTROL = 'public, max-age=86400'

interface ManifestPhoto {
  id: string
  title?: string
  description?: string
}

export interface OgResult {
  rendered: number
  removed: number
  skipped: number
}

function log(event: string, payload: object): void {
  // Workers logs every console method identically; `log` is the natural level.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...payload }))
}

/** FNV-1a; stable across runtimes and cheap enough to use as a cache key. */
export function shortHash(value: string): string {
  let hash = 0x811C9DC5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function ogCacheKey(photo: ManifestPhoto): string {
  const fingerprint = shortHash(`${photo.title ?? ''} ${photo.description ?? ''}`)
  return `${OG_PREFIX}${encodeURIComponent(photo.id)}-${fingerprint}.png`
}

/**
 * Renders OG cards ahead of crawler traffic and removes cards whose photo or
 * presentation (title/description) changed.
 */
export async function prewarmOgImages(env: CronEnv): Promise<OgResult> {
  const manifest = await loadManifest(env)
  const photos = ((manifest.data ?? []) as ManifestPhoto[]).filter(photo => typeof photo?.id === 'string')

  const expected = new Set(photos.map(photo => ogCacheKey(photo)))
  const existing = new Set((await listAll(env.PHOTOS, OG_PREFIX)).map(object => object.key))

  let rendered = 0
  let skipped = 0
  for (const photo of photos) {
    const key = ogCacheKey(photo)
    if (existing.has(key)) {
      continue
    }
    if (rendered >= MAX_OG_PER_RUN) {
      skipped++
      continue
    }
    const image = renderOgImage(photo)
    await env.PHOTOS.put(key, await image.arrayBuffer(), {
      httpMetadata: { contentType: 'image/png', cacheControl: OG_CACHE_CONTROL },
    })
    rendered++
  }

  const stale = [...existing].filter(key => !expected.has(key))
  await deleteKeys(env.PHOTOS, stale)
  return { rendered, removed: stale.length, skipped }
}

export async function runHourlyMaintenance(env: CronEnv): Promise<void> {
  const [cleanup, og] = await Promise.all([cleanupOrphanUploads(env), prewarmOgImages(env)])
  log('cron.hourly', { cleanup, og })
}

export async function runDailyBackup(env: CronEnv): Promise<void> {
  const backup = await backupD1(env)
  log('cron.backup', backup)
}

export async function runScheduled(cron: string, env: CronEnv): Promise<void> {
  if (cron === DAILY_BACKUP_CRON) {
    await runDailyBackup(env)
    return
  }
  await runHourlyMaintenance(env)
}
