import { Thumbhash } from '@afilmory/ui'
import { getViewerTransitionTriggerProps } from '@afilmory/viewer-motion'
import clsx from 'clsx'
import { m, useReducedMotion } from 'motion/react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'

import { siteConfig } from '~/config'
import { useContextPhotos, usePhotoViewer } from '~/hooks/usePhotoViewer'
import type { PhotoManifest } from '~/types/photo'

const HERO_PHOTO_COUNT = 6
const HERO_CANDIDATE_COUNT = 12
const EASE_OUT = [0.22, 1, 0.36, 1] as const

function parseTakenAt(photo: PhotoManifest): Date | null {
  const raw = photo.exif?.DateTimeOriginal
  if (typeof raw === 'string') {
    const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
    const date = new Date(normalized)
    if (!Number.isNaN(date.getTime())) {
      return date
    }
  }

  const fallback = new Date(photo.dateTaken)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

function formatMonth(photo: PhotoManifest): string | null {
  const date = parseTakenAt(photo)
  if (!date) {
    return null
  }
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`
}

function resolvePlace(photo: PhotoManifest): string | null {
  return photo.location?.city || photo.location?.locationName || photo.location?.country || null
}

/**
 * Pick the first six photos for the editorial composition. A vertical image is
 * promoted into the tall slot so the mosaic keeps a portrait anchor instead of
 * depending on whatever order the manifest happens to use.
 */
export function selectEditorialPhotos(photos: PhotoManifest[]): PhotoManifest[] {
  if (photos.length <= HERO_PHOTO_COUNT) {
    return photos
  }

  const candidates = photos.slice(0, HERO_CANDIDATE_COUNT)
  const tall = candidates.find((photo) => photo.aspectRatio < 0.9) ?? photos[0]
  if (!tall) {
    return []
  }

  const rest = photos.filter((photo) => photo.id !== tall.id).slice(0, HERO_PHOTO_COUNT - 1)
  return [tall, ...rest]
}

function formatArchiveYears(photos: PhotoManifest[]): string | null {
  const years = photos
    .map((photo) => parseTakenAt(photo)?.getFullYear())
    .filter((year): year is number => typeof year === 'number' && Number.isFinite(year))

  if (years.length === 0) {
    return null
  }

  const min = Math.min(...years)
  const max = Math.max(...years)
  return min === max ? `${min}` : `${min} — ${max}`
}

function topTags(photos: PhotoManifest[], limit: number): string[] {
  const counts = new Map<string, number>()
  for (const photo of photos) {
    for (const tag of photo.tags ?? []) {
      const normalized = tag.trim()
      if (normalized) {
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
      }
    }
  }

  return [...counts.entries()]
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([tag]) => tag)
}

type HeroPhotoProps = {
  photo: PhotoManifest
  index: number
  order: number
  eager?: boolean
  className?: string
}

const HeroPhoto = memo(({ photo, index, order, eager, className }: HeroPhotoProps) => {
  const photos = useContextPhotos()
  const photoViewer = usePhotoViewer()
  const reduceMotion = useReducedMotion()
  const [loaded, setLoaded] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const handleClick = useCallback(() => {
    const photoIndex = photos.findIndex((item) => item.id === photo.id)
    if (photoIndex !== -1) {
      photoViewer.openViewer(photoIndex, triggerRef.current ?? undefined)
    }
  }, [photo.id, photoViewer, photos])

  const indexLabel = String(index + 1).padStart(3, '0')
  const dateLabel = formatMonth(photo)
  const placeLabel = resolvePlace(photo)

  return (
    <m.figure
      className={clsx('group/photo m-0', className)}
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: order * 0.06, ease: EASE_OUT }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={photo.title}
        onClick={handleClick}
        className="bg-fill-quaternary relative block w-full cursor-pointer overflow-hidden"
        style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
        {...getViewerTransitionTriggerProps(photo.id)}
      >
        {photo.thumbHash && <Thumbhash thumbHash={photo.thumbHash} className="absolute inset-0" />}
        <img
          src={photo.thumbnailUrl}
          alt={photo.title}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={clsx(
            'absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-700 ease-out group-hover/photo:scale-[1.02]',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      </button>

      <figcaption className="mt-2 flex items-baseline gap-2 font-mono text-[9px] tracking-[0.22em] text-white/35 uppercase transition-colors duration-300 group-hover/photo:text-white/65">
        <span className="tabular-nums">{indexLabel}</span>
        {placeLabel && <span className="truncate">{placeLabel}</span>}
        {dateLabel && <span className="ml-auto tabular-nums">{dateLabel}</span>}
      </figcaption>
    </m.figure>
  )
})

type EditorialIntroProps = {
  photos: PhotoManifest[]
  featured: PhotoManifest[]
}

export function EditorialIntro({ photos, featured }: EditorialIntroProps) {
  const reduceMotion = useReducedMotion()
  const tags = useMemo(() => topTags(photos, 3), [photos])
  const years = useMemo(() => formatArchiveYears(photos), [photos])
  const wordmark = siteConfig.name.trim().toLowerCase()

  return (
    <section className="pt-4 lg:pt-20" aria-label="Photographic archive">
      <div className="grid grid-cols-12 gap-x-3 gap-y-10 lg:gap-x-6">
        <m.div
          className="col-span-12 flex flex-col lg:col-span-3 lg:min-h-[66vh] lg:justify-between lg:pr-8"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE_OUT }}
        >
          <div>
            <h1 className="text-[clamp(2.75rem,5vw,4.5rem)] leading-[0.85] font-extralight tracking-[-0.045em] text-white lowercase">
              {wordmark}
              <span className="text-white/45">.</span>
            </h1>
            <p className="mt-5 font-mono text-[9px] tracking-[0.42em] text-white/40 uppercase">Photographic Archive</p>
            {years && (
              <p className="mt-1.5 font-mono text-[9px] tracking-[0.3em] text-white/25 tabular-nums">{years}</p>
            )}

            <div className="mt-8 hidden h-14 w-px bg-white/15 lg:block" aria-hidden="true" />

            {tags.length > 0 && (
              <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] tracking-[0.24em] text-white/40 uppercase lg:mt-6 lg:block lg:space-y-1">
                {tags.map((tag) => (
                  <li key={tag} className="truncate">
                    {tag}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mt-6 font-mono text-[9px] tracking-[0.24em] text-white/25 uppercase lg:mt-0">
            {photos.length} photographs
          </p>
        </m.div>

        {/* Tall portrait anchor */}
        <div className="col-span-7 flex flex-col gap-3 sm:col-span-4 lg:col-span-3">
          {featured[0] && <HeroPhoto photo={featured[0]} index={0} order={1} eager />}
        </div>

        {/* Offset column keeps the composition asymmetric */}
        <div className="col-span-5 flex flex-col gap-3 sm:col-span-4 lg:col-span-2 lg:gap-5 lg:pt-24">
          {featured[1] && <HeroPhoto photo={featured[1]} index={1} order={2} />}
          {featured[2] && <HeroPhoto photo={featured[2]} index={2} order={3} />}
        </div>

        {/* Wide landscape plus a paired diptych */}
        <div className="col-span-12 flex flex-col gap-3 sm:col-span-4 lg:col-span-4 lg:gap-5">
          {featured[3] && <HeroPhoto photo={featured[3]} index={3} order={4} />}
          <div className="grid grid-cols-2 gap-3 lg:gap-5">
            {featured[4] && <HeroPhoto photo={featured[4]} index={4} order={5} />}
            {featured[5] && <HeroPhoto photo={featured[5]} index={5} order={6} />}
          </div>
        </div>
      </div>
    </section>
  )
}
