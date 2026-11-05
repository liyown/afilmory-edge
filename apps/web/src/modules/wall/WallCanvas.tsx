import { decompressUint8Array } from '@afilmory/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTransformContext, useTransformEffect, useTransformInit } from 'react-zoom-pan-pinch'
import { thumbHashToDataURL } from 'thumbhash'

import type { PhotoManifest } from '~/types/photo'

import type { WallCamera } from './wall-camera'
import { hitTest, intersects, isTap, toCanvasPoint, visibleRect } from './wall-camera'
import type { WallFrameInsets, WallLayout } from './wall-layout'
import { sliceVisibleItems } from './wall-layout'
import { PIVOT_RATIO, renderWall } from './wall-render'

interface WallCanvasProps {
  layout: WallLayout
  photos: PhotoManifest[]
  insets: WallFrameInsets
  accent: string
  onOpen: (index: number, element: HTMLElement) => void
}

const MAX_CONCURRENT_DECODES = 6
/** Originals are large; one at a time keeps decode memory bounded. */
const MAX_CONCURRENT_HIRES = 1
/** Extra canvas-space (screen px) around the viewport that is decoded ahead. */
const DECODE_AHEAD_PX = 220
/** Placeholders are cheap but not free, so build them just around the viewport. */
const PLACEHOLDER_AHEAD_PX = 80
/** Do not rescan the layout until the camera has moved this far (screen px). */
const DECODE_SCAN_STEP_PX = 140
const MAX_QUEUE = 64
/** Decoded thumbnails are evicted beyond this count once they leave the area. */
const MAX_DECODED_IMAGES = 160
const MAX_HIRES_IMAGES = 4
/** Above this camera scale the thumbnails are upscaled visibly. */
const HIRES_SCALE = 1.6
const HIRES_AHEAD_PX = 80
/** Time without camera movement before the cheap "moving" frame is redrawn. */
const MOTION_SETTLE_MS = 140
/** Movement (CSS px) below which a press counts as a tap rather than a pan. */
const TAP_SLOP_PX = 6

const releaseImage = (image: HTMLImageElement) => {
  image.onload = null
  image.onerror = null
  image.src = ''
}

/** The media route turns `?w=` into an OSS resize for deployments without stored previews. */
const resizeUrl = (url: string, width: number) =>
  `${url}${url.includes('?') ? '&' : '?'}w=${Math.max(64, Math.round(width))}`

const readViewport = (canvas: HTMLCanvasElement | null) => ({
  width: canvas?.clientWidth ?? window.innerWidth,
  height: canvas?.clientHeight ?? window.innerHeight,
})

/** Opt-in diagnostics for reporting jank from a real device: `?wallDebug=1`. */
const DEBUG_ENABLED = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('wallDebug')

const WallDebugHud = ({ read }: { read: () => string }) => {
  const [text, setText] = useState('')

  useEffect(() => {
    const tick = () => setText(read())
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [read])

  return (
    <div className="bg-material-thick/80 border-accent/20 text-text-secondary pointer-events-none fixed top-16 left-3 z-30 rounded-lg border px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre backdrop-blur-2xl">
      {text}
    </div>
  )
}

/**
 * Draws the whole wall into one canvas.
 *
 * A DOM wall paints 100+ nodes per frame because every photo carries its own
 * transform, radius, shadow and bitmap. With a canvas the gesture is just a
 * camera change and a frame is a handful of drawImage calls, so cost stays flat
 * as the gallery grows.
 */
export const WallCanvas = ({ layout, photos, insets, accent, onOpen }: WallCanvasProps) => {
  const instance = useTransformContext()
  const { i18n } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imagesRef = useRef(new Map<string, HTMLImageElement>())
  const hiresRef = useRef(new Map<string, HTMLImageElement>())
  const placeholdersRef = useRef(new Map<string, HTMLImageElement>())
  const frameRef = useRef(0)
  const pendingRef = useRef(new Set<string>())
  const failedRef = useRef(new Set<string>())
  const queueRef = useRef<string[]>([])
  const activeRef = useRef(0)
  const hiresPendingRef = useRef(new Set<string>())
  const hiresFailedRef = useRef(new Set<string>())
  const hiresQueueRef = useRef<string[]>([])
  const hiresActiveRef = useRef(0)
  const reducedRef = useRef(false)
  const disposedRef = useRef(false)
  /** Draw timestamps inside the last second, for the optional HUD. */
  const drawTimesRef = useRef<number[]>([])
  /** Camera of the last painted frame; used to detect motion and idle. */
  const lastDrawnCameraRef = useRef<WallCamera | null>(null)
  const settleTimerRef = useRef<number | null>(null)
  /** Camera of the last decode scan, so scans can be throttled. */
  const scanCameraRef = useRef<WallCamera | null>(null)
  /** Pointer-down origin, used to tell a tap apart from a pan. */
  const pressRef = useRef<{ x: number; y: number } | null>(null)

  const photoMap = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos])
  const itemMap = useMemo(() => new Map(layout.items.map((item) => [item.id, item])), [layout])

  // Refs keep the per-frame draw free of React renders; props are mirrored in.
  const propsRef = useRef({ accent, insets, layout, photos, locale: i18n.language, photoMap, itemMap })
  propsRef.current = { accent, insets, layout, photos, locale: i18n.language, photoMap, itemMap }

  const draw = useCallback(() => {
    frameRef.current = 0
    if (disposedRef.current) {
      return
    }
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }

    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }

    const current = propsRef.current
    const camera = instance.state
    renderWall({
      camera,
      ctx,
      dpr,
      viewportWidth: width,
      viewportHeight: height,
      layout: current.layout,
      photos: current.photos,
      insets: current.insets,
      accent: current.accent,
      locale: current.locale,
      images: imagesRef.current,
      hires: hiresRef.current,
      placeholders: placeholdersRef.current,
      reduced: reducedRef.current,
    })

    lastDrawnCameraRef.current = { scale: camera.scale, positionX: camera.positionX, positionY: camera.positionY }

    if (DEBUG_ENABLED) {
      const stamp = performance.now()
      const times = drawTimesRef.current
      times.push(stamp)
      while (times.length > 0 && stamp - times[0] > 1000) {
        times.shift()
      }
    }
  }, [instance])

  const schedule = useCallback(() => {
    if (disposedRef.current || frameRef.current) {
      return
    }
    frameRef.current = requestAnimationFrame(draw)
  }, [draw])

  /** Drops decoded thumbnails that are far outside the viewport. */
  const pruneDecodedImages = useCallback(() => {
    const images = imagesRef.current
    if (images.size <= MAX_DECODED_IMAGES) {
      return
    }

    const { width, height } = readViewport(canvasRef.current)
    const camera = instance.state
    const margin = Math.max(width, height) / Math.max(camera.scale, 0.01)
    const rect = visibleRect(camera, width, height, margin)
    const target = Math.floor(MAX_DECODED_IMAGES * 0.75)

    for (const [id, image] of images) {
      if (images.size <= target) {
        break
      }
      const item = propsRef.current.itemMap.get(id)
      if (item && intersects(item, rect)) {
        continue
      }
      releaseImage(image)
      images.delete(id)
    }
  }, [instance])

  const pumpRef = useRef<() => void>(() => {})
  const scanRef = useRef<(force?: boolean) => void>(() => {})

  const pump = useCallback(() => {
    while (activeRef.current < MAX_CONCURRENT_DECODES && queueRef.current.length > 0) {
      const id = queueRef.current.shift()!
      const photo = propsRef.current.photoMap.get(id)
      if (!photo || imagesRef.current.has(id)) {
        continue
      }

      pendingRef.current.add(id)
      activeRef.current += 1
      const image = new Image()
      image.decoding = 'async'
      let fellBack = false

      const settle = (ok: boolean) => {
        activeRef.current -= 1
        pendingRef.current.delete(id)
        if (!ok) {
          failedRef.current.add(id)
        }
        schedule()
        pumpRef.current()
        // Once the queue drains, look again: the camera may have stopped on
        // photos that were not queued during the last scan.
        if (queueRef.current.length === 0) {
          scanRef.current(true)
        }
      }

      image.onload = () => {
        // `onload` fires before the bitmap is decoded; waiting for `decode()`
        // keeps the first drawImage from blocking the main thread.
        void image
          .decode()
          .catch(() => undefined)
          .finally(() => {
            if (image.naturalWidth > 0) {
              imagesRef.current.set(id, image)
              pruneDecodedImages()
              settle(true)
            } else {
              settle(false)
            }
          })
      }
      image.onerror = () => {
        // Uploads normally store a 600px preview next to the original, but
        // older objects (and anything the cleanup cron removed before it was
        // fixed) do not. OSS can render that preview on demand.
        if (!fellBack) {
          fellBack = true
          image.src = resizeUrl(photo.originalUrl, 600)
          return
        }
        settle(false)
      }
      image.src = photo.thumbnailUrl || resizeUrl(photo.originalUrl, 600)
    }
  }, [pruneDecodedImages, schedule])
  pumpRef.current = pump

  const ensurePlaceholder = useCallback(
    (photo: PhotoManifest) => {
      if (!photo.thumbHash || placeholdersRef.current.has(photo.id)) {
        return
      }
      const hash = typeof photo.thumbHash === 'string' ? decompressUint8Array(photo.thumbHash) : photo.thumbHash
      const image = new Image()
      image.onload = schedule
      image.src = thumbHashToDataURL(hash)
      placeholdersRef.current.set(photo.id, image)
    },
    [schedule],
  )

  /** Items near the viewport, plus the rect they were selected with. */
  const nearItems = useCallback((camera: WallCamera, marginPx: number) => {
    const { width, height } = readViewport(canvasRef.current)
    const margin = marginPx / Math.max(camera.scale, 0.01)
    const rect = visibleRect(camera, width, height, margin)
    // Rows are contiguous, so only the intersecting band has to be examined.
    const rows = sliceVisibleItems(propsRef.current.layout, {
      left: rect.left,
      top: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    })
    return { rect, items: rows.filter((item) => intersects(item, rect)) }
  }, [])

  const pruneHires = useCallback(() => {
    const hires = hiresRef.current
    if (hires.size <= MAX_HIRES_IMAGES) {
      return
    }

    const { rect } = nearItems(instance.state, 0)
    for (const [id, image] of hires) {
      if (hires.size <= MAX_HIRES_IMAGES) {
        break
      }
      const item = propsRef.current.itemMap.get(id)
      if (item && intersects(item, rect)) {
        continue
      }
      releaseImage(image)
      hires.delete(id)
    }
  }, [instance, nearItems])

  const pumpHiresRef = useRef<() => void>(() => {})

  const pumpHires = useCallback(() => {
    while (hiresActiveRef.current < MAX_CONCURRENT_HIRES && hiresQueueRef.current.length > 0) {
      const id = hiresQueueRef.current.shift()!
      const photo = propsRef.current.photoMap.get(id)
      if (!photo || hiresRef.current.has(id)) {
        continue
      }

      hiresPendingRef.current.add(id)
      hiresActiveRef.current += 1
      const image = new Image()
      image.decoding = 'async'

      const finish = () => {
        hiresActiveRef.current -= 1
        hiresPendingRef.current.delete(id)
        schedule()
        pumpHiresRef.current()
        if (hiresQueueRef.current.length === 0) {
          scanRef.current(true)
        }
      }

      const settle = (ok: boolean) => {
        if (!ok) {
          hiresFailedRef.current.add(id)
        }
        finish()
      }

      image.onload = () => {
        void image
          .decode()
          .catch(() => undefined)
          .finally(() => {
            // The user may have zoomed back out while the original was in
            // flight; do not resurrect it after the cache was cleared.
            if (image.naturalWidth > 0 && instance.state.scale >= HIRES_SCALE) {
              hiresRef.current.set(id, image)
              pruneHires()
              finish()
            } else {
              if (image.naturalWidth > 0) {
                releaseImage(image)
              }
              // Not a failure: the photo can be requested again on the next
              // zoom-in, so it must not enter the failed set.
              finish()
            }
          })
      }
      image.onerror = () => settle(false)
      // Ask for only as many pixels as this frame occupies on screen instead
      // of pulling the (often multi-megabyte) original.
      const item = propsRef.current.itemMap.get(id)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const targetWidth = Math.min(
        2048,
        Math.max(600, Math.ceil((item?.photoWidth ?? 600) * instance.state.scale * dpr)),
      )
      image.src = resizeUrl(photo.originalUrl, targetWidth)
    }
  }, [instance, pruneHires, schedule])
  pumpHiresRef.current = pumpHires

  const scanHires = useCallback(
    (camera: WallCamera) => {
      const hires = hiresRef.current
      if (camera.scale < HIRES_SCALE) {
        if (hires.size > 0) {
          for (const image of hires.values()) {
            releaseImage(image)
          }
          hires.clear()
          schedule()
        }
        hiresQueueRef.current = []
        return
      }

      const { rect, items } = nearItems(camera, HIRES_AHEAD_PX)
      const centerX = (rect.left + rect.right) / 2
      const centerY = (rect.top + rect.bottom) / 2
      const candidates: { id: string; distance: number }[] = []

      for (const item of items) {
        const photo = propsRef.current.photoMap.get(item.id)
        if (!photo?.originalUrl) {
          continue
        }
        if (hires.has(item.id) || hiresPendingRef.current.has(item.id) || hiresFailedRef.current.has(item.id)) {
          continue
        }
        // Wait for the thumbnail: it tells us whether a bigger bitmap is
        // actually needed for the current on-screen size.
        const thumb = imagesRef.current.get(item.id)
        if (!thumb) {
          continue
        }
        if (thumb.naturalWidth >= item.photoWidth * camera.scale) {
          continue
        }
        const dx = item.x + item.width / 2 - centerX
        const dy = item.y + item.height / 2 - centerY
        candidates.push({ id: item.id, distance: dx * dx + dy * dy })
      }

      candidates.sort((a, b) => a.distance - b.distance)
      hiresQueueRef.current = candidates.slice(0, MAX_HIRES_IMAGES).map((entry) => entry.id)
      pumpHiresRef.current()
    },
    [nearItems, schedule],
  )

  /**
   * Rebuilds the decode queue for the current viewport. The queue is replaced
   * rather than appended to, which prunes photos the user has already left;
   * re-running is cheap and throttled by camera movement.
   */
  const scan = useCallback(
    (force = false) => {
      const camera = instance.state
      const previous = scanCameraRef.current
      if (!force && previous) {
        const moved = Math.abs(previous.positionX - camera.positionX) + Math.abs(previous.positionY - camera.positionY)
        const zoomed = previous.scale > 0 && Math.abs(previous.scale - camera.scale) / previous.scale > 0.02
        if (moved < DECODE_SCAN_STEP_PX && !zoomed) {
          return
        }
      }
      scanCameraRef.current = {
        scale: camera.scale,
        positionX: camera.positionX,
        positionY: camera.positionY,
      }

      const { width, height } = readViewport(canvasRef.current)
      const { rect, items } = nearItems(camera, DECODE_AHEAD_PX)
      const placeholderRect = visibleRect(camera, width, height, PLACEHOLDER_AHEAD_PX / Math.max(camera.scale, 0.01))
      const centerX = (rect.left + rect.right) / 2
      const centerY = (rect.top + rect.bottom) / 2
      const candidates: { id: string; distance: number }[] = []

      for (const item of items) {
        const photo = propsRef.current.photoMap.get(item.id)
        if (!photo) {
          continue
        }
        if (intersects(item, placeholderRect)) {
          ensurePlaceholder(photo)
        }
        if (imagesRef.current.has(item.id) || pendingRef.current.has(item.id) || failedRef.current.has(item.id)) {
          continue
        }
        const dx = item.x + item.width / 2 - centerX
        const dy = item.y + item.height / 2 - centerY
        candidates.push({ id: item.id, distance: dx * dx + dy * dy })
      }

      // Nearest-to-centre first: a drag over the wall never hammers the
      // network with corners the user is about to leave again.
      candidates.sort((a, b) => a.distance - b.distance)
      queueRef.current = candidates.slice(0, MAX_QUEUE).map((entry) => entry.id)
      pumpRef.current()
      scanHires(camera)
    },
    [ensurePlaceholder, instance, nearItems, scanHires],
  )
  scanRef.current = scan

  const onCameraChange = useCallback(() => {
    const camera = instance.state
    const previous = lastDrawnCameraRef.current
    if (previous) {
      const moved =
        Math.abs(previous.scale - camera.scale) > 1e-4 ||
        Math.abs(previous.positionX - camera.positionX) > 0.5 ||
        Math.abs(previous.positionY - camera.positionY) > 0.5
      if (moved) {
        // While the camera is moving, drop the expensive parts of the frame;
        // one clean frame is drawn once the gesture settles.
        reducedRef.current = true
        if (settleTimerRef.current !== null) {
          window.clearTimeout(settleTimerRef.current)
        }
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = null
          reducedRef.current = false
          schedule()
        }, MOTION_SETTLE_MS)
      }
    }
    schedule()
    scan()
  }, [instance, schedule, scan])

  useTransformEffect(onCameraChange)
  useTransformInit(() => {
    schedule()
    scan(true)
  })

  // A changed photo set invalidates the originals that were loaded for the old
  // layout; they are keyed by id, so they cannot be matched against new items.
  useEffect(() => {
    for (const image of hiresRef.current.values()) {
      releaseImage(image)
    }
    hiresRef.current.clear()
    hiresQueueRef.current = []
  }, [photos])

  useEffect(() => {
    scanCameraRef.current = null
    schedule()
    scan(true)
  }, [accent, i18n.language, insets, layout, photos, schedule, scan])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [schedule])

  useEffect(() => {
    return () => {
      disposedRef.current = true
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
      }
      queueRef.current = []
      hiresQueueRef.current = []
    }
  }, [])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    pressRef.current = { x: event.clientX, y: event.clientY }
  }, [])

  /**
   * Opens the frame under a tap. A drag also ends with a native `click`, so the
   * pointer's travel is measured against its press point: anything beyond a
   * few pixels was a pan, not a tap.
   */
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const press = pressRef.current
      pressRef.current = null
      if (!isTap(press, { x: event.clientX, y: event.clientY }, TAP_SLOP_PX)) {
        return
      }

      const canvas = canvasRef.current
      if (!canvas) {
        return
      }
      const bounds = canvas.getBoundingClientRect()
      const point = toCanvasPoint(instance.state, event.clientX - bounds.left, event.clientY - bounds.top)
      const hit = hitTest(propsRef.current.layout, point.x, point.y, PIVOT_RATIO)
      if (!hit) {
        return
      }
      onOpen(hit.index, canvas)
    },
    [instance, onOpen],
  )

  const readDebug = useCallback(() => {
    const camera = instance.state
    const lines = [
      // Draws are on demand, so an idle wall legitimately shows a low number.
      `draws ${drawTimesRef.current.length}/s`,
      `scale ${camera.scale.toFixed(2)}`,
      `cam   ${Math.round(camera.positionX)}, ${Math.round(camera.positionY)}`,
      `thumbs ${imagesRef.current.size}/${photos.length}  hires ${hiresRef.current.size}`,
      `queue ${queueRef.current.length}  moving ${reducedRef.current ? 'yes' : 'no'}`,
    ]
    return lines.join('\n')
  }, [instance, photos.length])

  return (
    <>
      <canvas
        ref={canvasRef}
        // The photo wall is exposed to assistive technology through the hidden
        // list rendered by WallView; the canvas itself is a picture.
        aria-hidden="true"
        className="pointer-events-auto"
        onPointerDown={handlePointerDown}
        style={{
          display: 'block',
          // The content box is the full wall size (that is what the library uses
          // for pan bounds), but the canvas only ever needs to cover the viewport.
          // `fixed` keeps it viewport-sized while the content transform is off.
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
        }}
        onClick={handleClick}
      />
      {DEBUG_ENABLED && <WallDebugHud read={readDebug} />}
    </>
  )
}
