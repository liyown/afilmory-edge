import type { PhotoManifest } from '~/types/photo'

import type { WallCamera } from './wall-camera'
import { pickItems, visibleRect } from './wall-camera'
import type { WallFrameInsets, WallLayout, WallLayoutItem } from './wall-layout'

const CAPTION_COLOR = '#514a3e'
const CAPTION_DATE_COLOR = '#8f8675'
const FRAME_BASE = '#fcfaf4'
const FRAME_MID = '#f7f3e7'
const FRAME_END = '#f1ecdd'
const PHOTO_BACKDROP = '#e7e1d2'
const PIVOT_RATIO = 0.1

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
  /** Decoded thumbhash placeholders, drawn until the real image is ready. */
  placeholders: Map<string, HTMLImageElement>
  /** True while the user is moving fast: skip the per-frame extras. */
  reduced: boolean
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

const formatCapturedAt = (photo: PhotoManifest, locale: string) => {
  const date = resolveCapturedAt(photo)
  if (!date) {
    return ''
  }
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short' }).format(date)
  } catch {
    return ''
  }
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

const drawFrame = (
  ctx: CanvasRenderingContext2D,
  item: WallLayoutItem,
  photo: PhotoManifest,
  options: RenderOptions,
) => {
  const { insets, accent, locale, images, reduced } = options
  const pivotX = item.x + item.width / 2
  const pivotY = item.y + item.height * PIVOT_RATIO

  ctx.save()
  if (item.rotation) {
    ctx.translate(pivotX, pivotY)
    ctx.rotate((item.rotation * Math.PI) / 180)
    ctx.translate(-pivotX, -pivotY)
  }

  const paper = ctx.createLinearGradient(0, item.y, 0, item.y + item.height)
  paper.addColorStop(0, FRAME_BASE)
  paper.addColorStop(0.58, FRAME_MID)
  paper.addColorStop(1, FRAME_END)

  if (!reduced) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
    ctx.shadowBlur = 18
    ctx.shadowOffsetY = 10
  }
  roundRect(ctx, item.x, item.y, item.width, item.height, 2)
  ctx.fillStyle = paper
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0

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

  const image = images.get(photo.id)
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

  // Caption: title on the left, date on the right.
  if (!reduced && photoWidth >= 120) {
    const baseline = item.y + item.height - insets.bottom / 2 + 3
    ctx.font = '500 11px Geist, ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'middle'

    const date = photoWidth >= 150 ? formatCapturedAt(photo, locale) : ''
    let available = photoWidth

    if (date) {
      ctx.font = '10px Geist, ui-sans-serif, system-ui, sans-serif'
      const dateWidth = ctx.measureText(date).width
      ctx.fillStyle = CAPTION_DATE_COLOR
      ctx.textAlign = 'right'
      ctx.fillText(date, photoX + photoWidth, baseline)
      available -= dateWidth + 8
    }

    if (photo.title && photoWidth >= 210) {
      ctx.font = '500 11px Geist, ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = CAPTION_COLOR
      ctx.textAlign = 'left'
      let text = photo.title
      if (ctx.measureText(text).width > available) {
        while (text.length > 1 && ctx.measureText(`${text}…`).width > available) {
          text = text.slice(0, -1)
        }
        text = `${text}…`
      }
      ctx.fillText(text, photoX, baseline)
    }
  }

  // Pin.
  const pinX = item.x + item.width / 2
  const pinY = item.y + 12
  const pinRadius = 8

  ctx.beginPath()
  ctx.ellipse(pinX, pinY + 7, 3, 2, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.fill()

  const pin = ctx.createRadialGradient(pinX - 3, pinY - 3, 1, pinX, pinY, pinRadius)
  pin.addColorStop(0, '#ffffff')
  pin.addColorStop(0.35, accent)
  pin.addColorStop(1, accent)
  ctx.beginPath()
  ctx.arc(pinX, pinY, pinRadius, 0, Math.PI * 2)
  ctx.fillStyle = pin
  ctx.fill()

  ctx.restore()
}

export const renderWall = (options: RenderOptions) => {
  const { ctx, camera, dpr, viewportWidth, viewportHeight, layout } = options

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewportWidth, viewportHeight)

  const rect = visibleRect(camera, viewportWidth, viewportHeight, 80)
  const visible = pickItems(layout, rect)

  ctx.save()
  ctx.translate(camera.positionX, camera.positionY)
  ctx.scale(camera.scale, camera.scale)

  for (const item of visible) {
    const photo = options.photos[item.index]
    if (photo) {
      drawFrame(ctx, item, photo, options)
    }
  }

  ctx.restore()
}

export { PIVOT_RATIO }
