import { decompressUint8Array } from '@afilmory/utils'
import { getViewerTransitionTriggerProps } from '@afilmory/viewer-motion'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { thumbHashToDataURL } from 'thumbhash'

import type { PhotoManifest } from '~/types/photo'

import styles from './wall.module.css'
import type { WallFrameInsets, WallLayoutItem } from './wall-layout'

interface WallFrameProps {
  item: WallLayoutItem
  photo: PhotoManifest
  insets: WallFrameInsets
  onOpen: (index: number, element: HTMLElement) => void
}

const resolveCapturedAt = (photo: PhotoManifest) => {
  const raw = photo.dateTaken || (photo.exif?.DateTimeOriginal as unknown as string | undefined) || photo.lastModified
  if (!raw) {
    return null
  }
  const normalized = typeof raw === 'string' ? raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') : raw
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export const WallFrame = memo(({ item, photo, insets, onOpen }: WallFrameProps) => {
  const { i18n } = useTranslation()
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  // A CSS background instead of an <img>: the placeholder never contributes a
  // decoded bitmap to the compositor, which matters when dozens of frames are
  // on screen at once.
  const placeholder = useMemo(() => {
    if (!photo.thumbHash) {
      return null
    }
    const hash = typeof photo.thumbHash === 'string' ? decompressUint8Array(photo.thumbHash) : photo.thumbHash
    return thumbHashToDataURL(hash)
  }, [photo.thumbHash])

  const capturedAt = useMemo(() => resolveCapturedAt(photo), [photo])
  const caption = useMemo(() => {
    if (!capturedAt) {
      return ''
    }
    return new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short' }).format(capturedAt)
  }, [capturedAt, i18n.language])

  const showTitle = item.photoWidth >= 210 && Boolean(photo.title)
  const showCaption = item.photoWidth >= 150 && Boolean(caption)

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onOpen(item.index, event.currentTarget)
    },
    [item.index, onOpen],
  )

  return (
    <button
      type="button"
      aria-label={photo.title || photo.id}
      className={styles.frame}
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.height,
        transform: `rotate(${item.rotation}deg)`,
      }}
      {...getViewerTransitionTriggerProps(photo.id)}
      onClick={handleClick}
    >
      <span
        className={styles.photo}
        style={{
          left: (item.width - item.photoWidth) / 2,
          top: insets.top,
          width: item.photoWidth,
          height: item.photoHeight,
          backgroundImage: placeholder ? `url("${placeholder}")` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {!hasError && (
          <img
            src={photo.thumbnailUrl || photo.originalUrl}
            alt={photo.title}
            className={styles.image}
            style={{ opacity: isLoaded ? 1 : 0 }}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setIsLoaded(true)}
            onError={() => setHasError(true)}
          />
        )}

        {hasError && (
          <span className="bg-fill-quaternary text-text-tertiary absolute inset-0 flex items-center justify-center">
            <i className="i-mingcute-image-line text-2xl" />
          </span>
        )}

        {photo.video && (
          <span className={styles.liveBadge}>
            <i className="i-mingcute-live-photo-line text-[10px]" />
            <span>{photo.video.type === 'live-photo' ? 'Live' : 'Motion'}</span>
          </span>
        )}
      </span>

      <span className={styles.caption}>
        {showTitle && <span className={styles.captionTitle}>{photo.title}</span>}
        {showCaption && <span className={styles.captionDate}>{caption}</span>}
      </span>

      <span className={styles.pin} aria-hidden="true" />
    </button>
  )
})

WallFrame.displayName = 'WallFrame'
