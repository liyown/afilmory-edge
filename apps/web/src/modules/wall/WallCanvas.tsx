import { decompressUint8Array } from '@afilmory/utils'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useTransformContext, useTransformEffect, useTransformInit } from 'react-zoom-pan-pinch'
import { thumbHashToDataURL } from 'thumbhash'

import type { PhotoManifest } from '~/types/photo'

import { hitTest, toCanvasPoint } from './wall-camera'
import type { WallFrameInsets, WallLayout } from './wall-layout'
import { PIVOT_RATIO, renderWall } from './wall-render'

interface WallCanvasProps {
  layout: WallLayout
  photos: PhotoManifest[]
  insets: WallFrameInsets
  accent: string
  onOpen: (index: number, element: HTMLElement) => void
}

const MAX_CONCURRENT_DECODES = 6
const DECODE_AHEAD_PX = 220

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
  const placeholdersRef = useRef(new Map<string, HTMLImageElement>())
  const frameRef = useRef(0)
  const pendingRef = useRef(new Set<string>())
  const queueRef = useRef<string[]>([])
  const activeRef = useRef(0)
  const reducedRef = useRef(false)
  const suppressClickRef = useRef(0)

  // Refs keep the per-frame draw free of React renders; props are mirrored in.
  const propsRef = useRef({ accent, insets, layout, photos, locale: i18n.language })
  propsRef.current = { accent, insets, layout, photos, locale: i18n.language }

  const draw = useCallback(() => {
    frameRef.current = 0
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
    renderWall({
      camera: instance.state,
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
      placeholders: placeholdersRef.current,
      reduced: reducedRef.current,
    })
  }, [instance])

  const schedule = useCallback(() => {
    if (frameRef.current) {
      return
    }
    frameRef.current = requestAnimationFrame(draw)
  }, [draw])

  useTransformEffect(schedule)
  useTransformInit(() => schedule())

  useEffect(() => {
    schedule()
  }, [layout, photos, accent, insets, schedule])

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
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
    }
  }, [])

  // Thumbhash placeholders decode instantly and make the first paint look
  // intentional instead of empty.
  useEffect(() => {
    let changed = false
    for (const photo of photos) {
      if (!photo.thumbHash || placeholdersRef.current.has(photo.id)) {
        continue
      }
      const hash = typeof photo.thumbHash === 'string' ? decompressUint8Array(photo.thumbHash) : photo.thumbHash
      const image = new Image()
      image.src = thumbHashToDataURL(hash)
      placeholdersRef.current.set(photo.id, image)
      changed = true
    }
    if (changed) {
      schedule()
    }
  }, [photos, schedule])

  const pump = useCallback(() => {
    while (activeRef.current < MAX_CONCURRENT_DECODES && queueRef.current.length > 0) {
      const id = queueRef.current.shift()!
      const photo = propsRef.current.photos.find((item) => item.id === id)
      if (!photo) {
        continue
      }
      activeRef.current += 1
      const image = new Image()
      image.decoding = 'async'
      const settle = () => {
        activeRef.current -= 1
        pendingRef.current.delete(id)
        schedule()
        pump()
      }
      image.onload = () => {
        imagesRef.current.set(id, image)
        settle()
      }
      image.onerror = settle
      image.src = photo.thumbnailUrl || photo.originalUrl
    }
  }, [schedule])

  // Queue thumbnails that are near the viewport; thumbnails are only decoded
  // shortly before they are needed, so first paint stays cheap.
  const enqueueAroundViewport = useCallback(() => {
    const { scale, positionX, positionY } = instance.state
    if (!scale) {
      return
    }
    const width = canvasRef.current?.clientWidth ?? window.innerWidth
    const height = canvasRef.current?.clientHeight ?? window.innerHeight
    const rect = {
      left: -positionX / scale - DECODE_AHEAD_PX,
      top: -positionY / scale - DECODE_AHEAD_PX,
      right: (width - positionX) / scale + DECODE_AHEAD_PX,
      bottom: (height - positionY) / scale + DECODE_AHEAD_PX,
    }

    let queued = 0
    for (const item of propsRef.current.layout.items) {
      const photo = propsRef.current.photos[item.index]
      if (!photo || imagesRef.current.has(photo.id) || pendingRef.current.has(photo.id)) {
        continue
      }
      const near =
        item.x + item.width >= rect.left &&
        item.x <= rect.right &&
        item.y + item.height >= rect.top &&
        item.y <= rect.bottom
      if (!near) {
        continue
      }
      pendingRef.current.add(photo.id)
      queueRef.current.push(photo.id)
      queued += 1
      if (queued >= 32) {
        break
      }
    }
    pump()
  }, [instance, pump])

  useTransformEffect(enqueueAroundViewport)
  useTransformInit(() => enqueueAroundViewport())
  useEffect(() => {
    enqueueAroundViewport()
  }, [enqueueAroundViewport, layout, photos])

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (Date.now() < suppressClickRef.current) {
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
      suppressClickRef.current = Date.now() + 280
      onOpen(hit.index, canvas)
    },
    [instance, onOpen],
  )

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-auto"
      style={{ display: 'block', width: '100%', height: '100%' }}
      onClick={handleClick}
    />
  )
}
