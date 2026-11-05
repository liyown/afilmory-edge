import { Thumbhash } from '@afilmory/ui'
import { Spring } from '@afilmory/utils'
import { getViewerTransitionTriggerProps } from '@afilmory/viewer-motion'
import clsx from 'clsx'
import { m, useReducedMotion } from 'motion/react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'

import { siteConfig } from '~/config'
import { useContextPhotos, usePhotoViewer } from '~/hooks/usePhotoViewer'
import type { PhotoManifest } from '~/types/photo'

const HERO_PHOTO_COUNT = 6
const HERO_CANDIDATE_COUNT = 12

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
      className={clsx('group/photo m-0 flex w-full min-w-0 flex-col', className)}
      initial={reduceMotion ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...Spring.smooth(0.72), delay: order * 0.055 }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={photo.title}
        onClick={handleClick}
        className="bg-fill-quaternary focus-visible:ring-accent/50 relative block aspect-[4/3] w-full cursor-pointer overflow-hidden rounded-sm focus-visible:ring-2 focus-visible:outline-none lg:aspect-auto lg:min-h-0 lg:flex-1"
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
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-300',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      </button>

      <figcaption className="border-border mt-2 flex items-baseline gap-2 border-t pt-1.5 font-mono text-[9px] tracking-[0.18em] text-text-tertiary uppercase transition-colors duration-200 group-hover/photo:text-text-secondary">
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
    <section className="pt-4 lg:pt-16" aria-label="Photographic archive">
      <m.header
        className="mb-10 grid grid-cols-12 gap-x-4 gap-y-6 lg:mb-14 lg:gap-x-6"
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={Spring.smooth(0.7)}
      >
        <div className="col-span-12 lg:col-span-7">
          <p className="text-text-tertiary mb-4 flex items-center gap-2.5 font-mono text-[9px] tracking-[0.32em] uppercase">
            <span className="bg-accent/60 size-1 rounded-full" aria-hidden="true" />
            Photographic Archive
          </p>
          <h1 className="text-text max-w-[9ch] text-[clamp(2.5rem,6.2vw,6rem)] leading-[0.92] font-extralight tracking-[-0.055em] lowercase break-words">
            {wordmark}
            <span className="text-accent/70">.</span>
          </h1>
          {years && (
            <p className="text-text-quaternary mt-4 font-mono text-[10px] tracking-[0.3em] tabular-nums">{years}</p>
          )}
        </div>

        <div className="col-span-12 flex flex-col justify-end gap-5 lg:col-span-4 lg:col-start-9">
          {tags.length > 0 && (
            <ul className="text-text-tertiary flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[9px] tracking-[0.24em] uppercase">
              {tags.map((tag) => (
                <li key={tag} className="flex items-center gap-2">
                  <span className="bg-fill-tertiary size-1 rounded-full" aria-hidden="true" />
                  {tag}
                </li>
              ))}
            </ul>
          )}
          <div className="border-border flex items-baseline justify-between border-t pt-3">
            <span className="text-text-quaternary font-mono text-[9px] tracking-[0.28em] uppercase">
              In this archive
            </span>
            <span className="text-text-secondary font-mono text-lg font-light tabular-nums">
              {String(photos.length).padStart(2, '0')}
            </span>
          </div>
        </div>
      </m.header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:h-[min(88vh,820px)] lg:grid-cols-12 lg:grid-rows-3 lg:gap-x-6 lg:gap-y-8">
        <div className="col-span-2 flex min-h-0 sm:col-span-4 lg:col-span-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {featured[0] && <HeroPhoto photo={featured[0]} index={0} order={1} eager className="h-full" />}
        </div>

        <div className="col-span-1 flex min-h-0 sm:col-span-2 lg:col-span-3 lg:col-start-6 lg:row-start-1">
          {featured[1] && <HeroPhoto photo={featured[1]} index={1} order={2} className="h-full" />}
        </div>

        <div className="col-span-1 flex min-h-0 sm:col-span-2 lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1">
          {featured[2] && <HeroPhoto photo={featured[2]} index={2} order={3} className="h-full" />}
        </div>

        <div className="col-span-1 flex min-h-0 sm:col-span-2 lg:col-span-3 lg:col-start-6 lg:row-start-2">
          {featured[3] && <HeroPhoto photo={featured[3]} index={3} order={4} className="h-full" />}
        </div>

        <div className="col-span-1 flex min-h-0 sm:col-span-2 lg:col-span-5 lg:col-start-1 lg:row-start-3">
          {featured[4] && <HeroPhoto photo={featured[4]} index={4} order={5} className="h-full" />}
        </div>

        <div className="col-span-2 flex min-h-0 sm:col-span-4 lg:col-span-7 lg:col-start-6 lg:row-start-3">
          {featured[5] && <HeroPhoto photo={featured[5]} index={5} order={6} className="h-full" />}
        </div>
      </div>
    </section>
  )
}
