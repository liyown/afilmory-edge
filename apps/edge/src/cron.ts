// Scheduled work:
// - hourly: delete OSS objects left behind by interrupted uploads, refresh the
//   OG image cache, and drop OG entries for photos that no longer exist;
// - daily: export every D1 table into a gzipped JSON document in the bucket.
//
// Both tasks are idempotent, so a retried cron invocation is safe.

import type { CronEnv } from './cron-maintenance'
import { backupD1, cleanupOrphanUploads, deleteKeys, listAll } from './cron-maintenance'
import { loadManifest } from './html'
import { runPhotoAiBackfill } from './modules/photos/photo-ai-backfill'
import { renderHomepageOgImage, renderPhotoOgImage } from './og'
import type { OgSiteConfig } from './og-site'
import { loadOgSiteConfig } from './og-site'
import type { OgPhoto } from './og-template'
import { storagePut } from './storage'

// Keep both literals in sync with cloudflare.config.ts (the dev server cannot
// import Worker source from the config module).
export const HOURLY_CRON = '0 * * * *'
export const DAILY_BACKUP_CRON = '30 2 * * *'

const OG_PREFIX = 'og/'
// Bump when the card template or font changes so cached PNGs are re-rendered.
const OG_TEMPLATE_VERSION = 'v4'
const MAX_OG_PER_RUN = 50
const OG_CACHE_CONTROL = 'public, max-age=86400'
// The assets binding resolves by pathname; the host only matters in local dev,
// where request-driven renders pass the real origin instead.
const OG_ASSETS_ORIGIN = 'https://assets.local'

export interface OgResult {
  rendered: number
  removed: number
  skipped: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

export function photoOgCacheKey(photo: OgPhoto, site: OgSiteConfig): string {
  const fingerprint = shortHash(
    JSON.stringify({
      title: photo.title ?? '',
      description: photo.description ?? '',
      tags: photo.tags ?? [],
      dateTaken: photo.dateTaken ?? '',
      format: photo.format ?? '',
      width: photo.width ?? 0,
      height: photo.height ?? 0,
      s3Key: photo.s3Key ?? '',
      exif: photo.exif ?? null,
      site: { name: site.name, accentColor: site.accentColor },
    }),
  )
  return `${OG_PREFIX}${encodeURIComponent(photo.id)}-${OG_TEMPLATE_VERSION}-${fingerprint}.png`
}

export function homepageOgCacheKey(site: OgSiteConfig, photos: OgPhoto[]): string {
  const fingerprint = shortHash(
    JSON.stringify({
      site: {
        name: site.name,
        description: site.description,
        accentColor: site.accentColor,
        avatar: site.authorAvatar,
      },
      featured: photos.slice(0, 6).map((photo) => `${photo.s3Key ?? ''}:${photo.lastModified ?? ''}`),
    }),
  )
  return `${OG_PREFIX}homepage-${OG_TEMPLATE_VERSION}-${fingerprint}.png`
}

/**
 * Renders OG cards ahead of crawler traffic and removes cards whose photo or
 * presentation changed.
 */
export async function prewarmOgImages(env: CronEnv): Promise<OgResult> {
  const manifest = await loadManifest(env)
  const photos = ((manifest.data ?? []) as OgPhoto[]).filter((photo) => typeof photo?.id === 'string')
  const cameras = Array.isArray(manifest.cameras) ? manifest.cameras.length : 0
  const site = await loadOgSiteConfig(env)

  const homepageKey = homepageOgCacheKey(site, photos)
  const expected = new Set([homepageKey, ...photos.map((photo) => photoOgCacheKey(photo, site))])
  const existing = new Set((await listAll(OG_PREFIX)).map((object) => object.key))

  let rendered = 0
  let skipped = 0
  for (const photo of photos) {
    const key = photoOgCacheKey(photo, site)
    if (existing.has(key)) {
      continue
    }
    if (rendered >= MAX_OG_PER_RUN) {
      skipped++
      continue
    }
    try {
      const image = await renderPhotoOgImage(env, photo, site, OG_ASSETS_ORIGIN)
      await storagePut(key, image, {
        contentType: 'image/png',
        cacheControl: OG_CACHE_CONTROL,
      })
      rendered++
    } catch (error) {
      log('cron.og.photo.failed', { photoId: photo.id, message: errorMessage(error) })
      skipped++
    }
  }

  if (!existing.has(homepageKey)) {
    if (rendered >= MAX_OG_PER_RUN) {
      skipped++
    } else {
      try {
        const image = await renderHomepageOgImage(env, site, photos, cameras, OG_ASSETS_ORIGIN)
        await storagePut(homepageKey, image, {
          contentType: 'image/png',
          cacheControl: OG_CACHE_CONTROL,
        })
        rendered++
      } catch (error) {
        log('cron.og.homepage.failed', { message: errorMessage(error) })
        skipped++
      }
    }
  }

  const stale = [...existing].filter((key) => !expected.has(key))
  await deleteKeys(stale)
  return { rendered, removed: stale.length, skipped }
}

export async function runHourlyMaintenance(env: CronEnv): Promise<void> {
  const [cleanup, og] = await Promise.all([cleanupOrphanUploads(env), prewarmOgImages(env)])
  let aiIndexed = 0
  try {
    aiIndexed = await runPhotoAiBackfill(10)
  } catch (error) {
    log('cron.ai.failed', { message: errorMessage(error) })
  }
  log('cron.hourly', { cleanup, og, aiIndexed })
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
