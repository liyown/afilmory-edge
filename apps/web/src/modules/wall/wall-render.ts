import { toIntlLocale } from '~/lib/intl'
import type { PhotoManifest } from '~/types/photo'

import type { WallCamera } from './wall-camera'
import { intersects, visibleRect } from './wall-camera'
import type { WallFrameInsets, WallLayout, WallLayoutItem } from './wall-layout'
import { sliceVisibleItems } from './wall-layout'

const CAPTION_COLOR = '#514a3e'
const CAPTION_DATE_COLOR = '#8f8675'
const FRAME_BASE = '#fcfaf4'
const FRAME_MID = '#f7f3e7'
const FRAME_END = '#f1ecdd'
const PHOTO_BACKDROP = '#e7e1d2'
const PIVOT_RATIO = 0.1

const TITLE_FONT = '500 11px Geist, ui-sans-serif, system-ui, sans-serif'
const DATE_FONT = '10px Geist, ui-sans-serif, system-ui, sans-serif'

/** Canvas-space margin kept around the viewport, expressed in screen pixels. */
const CULL_SCREEN_MARGIN = 140
/** Text work is memoized; a full gallery fits comfortably below this. */
const TEXT_CACHE_LIMIT = 4000

const dateLabelCache = new Map<string, string>()
const dateWidthCache = new Map<string, number>()
const titleCache = new Map<string, string>()
const formatterCache = new Map<string, Intl.DateTimeFormat>()

const remember = <T>(cache: Map<string, T>, key: string, value: T): T => {
  if (cache.size >= TEXT_CACHE_LIMIT) {
    cache.clear()
  }
  cache.set(key, value)
  return value
}

const resolveRawDate = (photo: PhotoManifest) =>
  photo.dateTaken || (photo.exif?.DateTimeOriginal as unknown as string | undefined) || photo.lastModified

const getFormatter = (locale: string) => {
  const cached = formatterCache.get(locale)
  if (cached) {
    return cached
  }
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat(toIntlLocale(locale), { year: 'numeric', month: 'short' })
  } catch {
    formatter = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short' })
  }
  formatterCache.set(locale, formatter)
  return formatter
}

/**
 * The label used to be formatted (including a fresh `Intl.DateTimeFormat`) on
 * every frame for every visible frame. Both the parse and the format are now
 * memoized by the raw date, which is immutable per photo.
 */
const formatCapturedAt = (photo: PhotoManifest, locale: string) => {
  const raw = resolveRawDate(photo)
  if (!raw) {
    return ''
  }
  const key = `${locale}|${raw}`
  const cached = dateLabelCache.get(key)
  if (cached !== undefined) {
    return cached
  }
  const normalized = typeof raw === 'string' ? raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') : raw
  const date = new Date(normalized)
  const label = Number.isNaN(date.getTime()) ? '' : getFormatter(locale).format(date)
  return remember(dateLabelCache, key, label)
}

const measureDate = (ctx: CanvasRenderingContext2D, label: string) => {
  const cached = dateWidthCache.get(label)
  if (cached !== undefined) {
    return cached
  }
  return remember(dateWidthCache, label, ctx.measureText(label).width)
}

/** Truncation depends only on the label and the available width, so it is cached too. */
const fitTitle = (ctx: CanvasRenderingContext2D, photo: PhotoManifest, available: number) => {
  const key = `${photo.id}|${Math.round(available)}|${photo.title}`
  const cached = titleCache.get(key)
  if (cached !== undefined) {
    return cached
  }

  let text = photo.title
  if (ctx.measureText(text).width > available) {
    while (text.length > 1 && ctx.measureText(`${text}…`).width > available) {
      text = text.slice(0, -1)
    }
    text = `${text}…`
  }
  return remember(titleCache, key, text)
}

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

/*
 * Soft shadows used to be produced with `shadowBlur` for every frame on every
 * frame, which is one of the most expensive canvas operations. A single
 * pre-blurred sprite is stretched under each frame instead.
 */
const SHADOW_CORE = 160
const SHADOW_PADDING = 40
const SHADOW_LAYERS = 9
let shadowSprite: HTMLCanvasElement | null | undefined

const getShadowSprite = () => {
  if (shadowSprite !== undefined) {
    return shadowSprite
  }
  if (typeof document === 'undefined') {
    shadowSprite = null
    return null
  }

  const size = SHADOW_CORE + SHADOW_PADDING * 2
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    shadowSprite = null
    return null
  }

  // Stacked translucent rounded rectangles approximate a blur without relying
  // on `ctx.filter`, which is still unevenly supported.
  for (let layer = SHADOW_LAYERS; layer >= 1; layer--) {
    const spread = layer * 2.5
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)'
    roundRect(
      ctx,
      SHADOW_PADDING - spread,
      SHADOW_PADDING - spread,
      SHADOW_CORE + spread * 2,
      SHADOW_CORE + spread * 2,
      3 + spread,
    )
    ctx.fill()
  }

  shadowSprite = canvas
  return canvas
}

const drawShadow = (ctx: CanvasRenderingContext2D, item: WallLayoutItem) => {
  const sprite = getShadowSprite()
  if (!sprite) {
    return
  }
  const scaleX = item.width / SHADOW_CORE
  const scaleY = item.height / SHADOW_CORE
  const padX = SHADOW_PADDING * scaleX
  const padY = SHADOW_PADDING * scaleY
  ctx.drawImage(sprite, item.x - padX, item.y - padY + 10, item.width + padX * 2, item.height + padY * 2)
}

/*
 * The pin is a radial gradient plus a drop shadow. Rasterizing it once per
 * accent keeps it out of the per-frame draw path.
 */
const PIN_SPRITE_SIZE = 40
let pinSprite: { accent: string; canvas: HTMLCanvasElement } | null = null

const getPinSprite = (accent: string) => {
  if (pinSprite?.accent === accent) {
    return pinSprite.canvas
  }
  if (typeof document === 'undefined') {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = PIN_SPRITE_SIZE
  canvas.height = PIN_SPRITE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  // Sprite space: pin centre (20, 16), radius 8, shadow below it.
  ctx.beginPath()
  ctx.ellipse(20, 23, 3, 2, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.fill()

  const pin = ctx.createRadialGradient(17, 13, 1, 20, 16, 8)
  pin.addColorStop(0, '#ffffff')
  pin.addColorStop(0.35, accent)
  pin.addColorStop(1, accent)
  ctx.beginPath()
  ctx.arc(20, 16, 8, 0, Math.PI * 2)
  ctx.fillStyle = pin
  ctx.fill()

  pinSprite = { accent, canvas }
  return canvas
}

interface RenderOptions {
  camera: WallCamera
  ctx: CanvasRenderingContext2D
  /** CSS pixel size of the viewport. */
  viewportWidth: number
  viewportHeight: number
  dpr: number
  layout: WallLayout
  photos: PhotoManifest[]
  insets: WallFrameInsets
  accent: string
  locale: string
  images: Map<string, HTMLImageElement>
  /** Higher-resolution bitmaps, used once the camera is zoomed in far enough. */
  hires: Map<string, HTMLImageElement>
  /** Decoded thumbhash placeholders, drawn until the real image is ready. */
  placeholders: Map<string, HTMLImageElement>
  /** True while the user is moving fast: skip the per-frame extras. */
  reduced: boolean
}

const drawCaption = (
  ctx: CanvasRenderingContext2D,
  item: WallLayoutItem,
  photo: PhotoManifest,
  insets: WallFrameInsets,
  locale: string,
  photoX: number,
  photoWidth: number,
) => {
  const baseline = item.y + item.height - insets.bottom / 2 + 3
  ctx.textBaseline = 'middle'

  const date = photoWidth >= 150 ? formatCapturedAt(photo, locale) : ''
  let available = photoWidth

  if (date) {
    ctx.font = DATE_FONT
    const dateWidth = measureDate(ctx, date)
    ctx.fillStyle = CAPTION_DATE_COLOR
    ctx.textAlign = 'right'
    ctx.fillText(date, photoX + photoWidth, baseline)
    available -= dateWidth + 8
  }

  if (photo.title && photoWidth >= 210) {
    ctx.font = TITLE_FONT
    ctx.fillStyle = CAPTION_COLOR
    ctx.textAlign = 'left'
    ctx.fillText(fitTitle(ctx, photo, available), photoX, baseline)
  }
}

const drawFrame = (
  ctx: CanvasRenderingContext2D,
  item: WallLayoutItem,
  photo: PhotoManifest,
  options: RenderOptions,
) => {
  const { insets, accent, locale, images, hires, reduced } = options
  const pivotX = item.x + item.width / 2
  const pivotY = item.y + item.height * PIVOT_RATIO

  ctx.save()
  if (item.rotation) {
    ctx.translate(pivotX, pivotY)
    ctx.rotate((item.rotation * Math.PI) / 180)
    ctx.translate(-pivotX, -pivotY)
  }

  if (!reduced) {
    drawShadow(ctx, item)
  }

  const paper = ctx.createLinearGradient(0, item.y, 0, item.y + item.height)
  paper.addColorStop(0, FRAME_BASE)
  paper.addColorStop(0.58, FRAME_MID)
  paper.addColorStop(1, FRAME_END)

  roundRect(ctx, item.x, item.y, item.width, item.height, 2)
  ctx.fillStyle = paper
  ctx.fill()

  // Photo well.
  const photoX = item.x + insets.side
  const photoY = item.y + insets.top
  const photoWidth = item.photoWidth
  const photoHeight = item.photoHeight

  ctx.save()
  ctx.beginPath()
  ctx.rect(photoX, photoY, photoWidth, photoHeight)
  ctx.clip()

  ctx.fillStyle = PHOTO_BACKDROP
  ctx.fillRect(photoX, photoY, photoWidth, photoHeight)

  const thumb = images.get(photo.id)
  const hiresImage = hires.get(photo.id)
  const image = hiresImage && hiresImage.naturalWidth > 0 ? hiresImage : thumb
  if (image && image.naturalWidth > 0) {
    // Cover fit.
    const imageAspect = image.naturalWidth / image.naturalHeight
    const boxAspect = photoWidth / photoHeight
    let drawWidth = photoWidth
    let drawHeight = photoHeight
    if (imageAspect > boxAspect) {
      drawHeight = photoHeight
      drawWidth = photoHeight * imageAspect
    } else {
      drawWidth = photoWidth
      drawHeight = photoWidth / imageAspect
    }
    const drawX = photoX + (photoWidth - drawWidth) / 2
    const drawY = photoY + (photoHeight - drawHeight) / 2
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)
  } else {
    const placeholder = options.placeholders.get(photo.id)
    if (placeholder && placeholder.naturalWidth > 0) {
      ctx.drawImage(placeholder, photoX, photoY, photoWidth, photoHeight)
    }
  }

  ctx.restore()

  // Inner hairline around the photo.
  ctx.strokeStyle = 'rgba(70, 60, 44, 0.16)'
  ctx.lineWidth = 1
  ctx.strokeRect(photoX + 0.5, photoY + 0.5, photoWidth - 1, photoHeight - 1)

  if (!reduced) {
    drawCaption(ctx, item, photo, insets, locale, photoX, photoWidth)
  }

  const pin = getPinSprite(accent)
  if (pin) {
    ctx.drawImage(
      pin,
      item.x + item.width / 2 - PIN_SPRITE_SIZE / 2,
      item.y + 12 - 16,
      PIN_SPRITE_SIZE,
      PIN_SPRITE_SIZE,
    )
  }

  ctx.restore()
}

export const renderWall = (options: RenderOptions) => {
  const { ctx, camera, dpr, viewportWidth, viewportHeight, layout } = options

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewportWidth, viewportHeight)

  // Rows are stored in order, so the visible band is a contiguous slice; only
  // the items in those rows that actually intersect the rect are drawn.
  const margin = CULL_SCREEN_MARGIN / Math.max(camera.scale, 0.01)
  const rect = visibleRect(camera, viewportWidth, viewportHeight, margin)
  const candidates = sliceVisibleItems(layout, {
    left: rect.left,
    top: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  })

  ctx.save()
  ctx.translate(camera.positionX, camera.positionY)
  ctx.scale(camera.scale, camera.scale)

  for (const item of candidates) {
    if (!intersects(item, rect)) {
      continue
    }
    const photo = options.photos[item.index]
    if (photo) {
      drawFrame(ctx, item, photo, options)
    }
  }

  ctx.restore()
}

export { PIVOT_RATIO }
