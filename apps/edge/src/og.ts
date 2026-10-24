import { ImageResponse } from 'workers-og'

import { GEIST_MEDIUM_B64 } from './assets/geist-medium.b64'
import { thumbnailKeyFor } from './modules/photos/photo-ai-utils'
import type { OgSiteConfig } from './og-site'
import type { OgExif, OgExifInfo, OgPhoto } from './og-template'
import { buildHomepageOgHtml, buildPhotoOgHtml, OG_HEIGHT, OG_WIDTH } from './og-template'
import { storageGet } from './storage'

const CJK_FONT_PATH = '/fonts/HarmonyOS_Sans_SC_Medium.ttf'
// Satori embeds the picture into the SVG it renders; keeping the source image
// bounded keeps both the data URL and the wasm rasteriser inside Worker memory.
const MAX_OG_SOURCE_BYTES = 4 * 1024 * 1024
const MAX_OG_HOMEPAGE_BYTES = 12 * 1024 * 1024
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const SUPPORTED_IMAGE_FORMATS = new Set(['JPG', 'JPEG', 'PNG', 'WEBP', 'GIF'])

const CONTENT_TYPES: Record<string, string> = {
  JPG: 'image/jpeg',
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  GIF: 'image/gif',
}

export type OgEnv = Pick<Env, 'ASSETS'>

interface ImageBudget {
  remaining: number
}

type OgFont = {
  name: string
  data: ArrayBuffer
  weight: 400
  style: 'normal'
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

let geistFontCache: ArrayBuffer | undefined
let cjkFontPromise: Promise<ArrayBuffer | null> | undefined

function geistFont(): ArrayBuffer {
  geistFontCache ??= decodeBase64(GEIST_MEDIUM_B64)
  return geistFontCache
}

async function loadCjkFont(env: OgEnv, origin: string): Promise<ArrayBuffer | null> {
  if (!cjkFontPromise) {
    cjkFontPromise = (async () => {
      // Static assets are resolved by pathname; dev additionally requires the
      // URL to match the server origin, which callers pass in.
      const response = await env.ASSETS.fetch(new URL(CJK_FONT_PATH, origin))
      return response.ok ? await response.arrayBuffer() : null
    })().catch(() => null)
  }

  const font = await cjkFontPromise
  if (!font) {
    // Allow a later request to retry after a transient asset failure.
    cjkFontPromise = undefined
  }
  return font
}

async function loadFonts(env: OgEnv, origin: string): Promise<OgFont[]> {
  const fonts: OgFont[] = [{ name: 'Geist', data: geistFont(), weight: 400, style: 'normal' }]
  const cjk = await loadCjkFont(env, origin)
  if (cjk) {
    fonts.push({ name: 'HarmonyOS Sans SC', data: cjk, weight: 400, style: 'normal' })
  }
  return fonts
}

function toDataUrl(buffer: ArrayBuffer, contentType: string): string {
  return `data:${contentType};base64,${encodeBase64(new Uint8Array(buffer))}`
}

async function resolvePhotoImage(env: OgEnv, photo: OgPhoto, budget: ImageBudget): Promise<string | null> {
  if (!photo.s3Key) {
    return null
  }

  const format = (photo.format ?? '').toUpperCase()
  // Prefer the 600px sidecar: full-size originals regularly exceed the Worker
  // CPU/memory budget, which is what left cards with a "No Preview" frame.
  const candidates: Array<{ key: string; contentType: string }> = [
    { key: thumbnailKeyFor(photo.s3Key), contentType: 'image/jpeg' },
  ]
  if (SUPPORTED_IMAGE_FORMATS.has(format)) {
    candidates.push({ key: photo.s3Key, contentType: CONTENT_TYPES[format] ?? 'image/jpeg' })
  }

  for (const candidate of candidates) {
    const object = await storageGet(candidate.key)
    if (!object || object.size > budget.remaining) {
      continue
    }

    const buffer = await object.response.arrayBuffer()
    budget.remaining -= buffer.byteLength
    return toDataUrl(buffer, object.response.headers.get('content-type') ?? candidate.contentType)
  }

  return null
}

async function resolveAvatar(avatarUrl: string | null | undefined): Promise<string | null> {
  if (!avatarUrl) {
    return null
  }
  if (avatarUrl.startsWith('data:')) {
    return avatarUrl
  }
  if (!/^https?:\/\//i.test(avatarUrl)) {
    return null
  }

  try {
    const response = await fetch(avatarUrl)
    if (!response.ok) {
      return null
    }
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_AVATAR_BYTES) {
      return null
    }
    return toDataUrl(buffer, response.headers.get('content-type') ?? 'image/png')
  } catch {
    return null
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatOgDate(input?: string | null): string | undefined {
  if (!input) {
    return undefined
  }
  const timestamp = Date.parse(input)
  if (Number.isNaN(timestamp)) {
    return undefined
  }
  const date = new Date(timestamp)
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}

function buildExifInfo(exif: OgExif | null | undefined): OgExifInfo | null {
  if (!exif) {
    return null
  }

  const focalLength = exif.FocalLengthIn35mmFormat || exif.FocalLength
  const aperture = exif.FNumber ? `f/${exif.FNumber}` : null
  const iso = exif.ISO ?? null
  const shutterSpeed = exif.ExposureTime ? `${exif.ExposureTime}s` : null
  const camera =
    exif.Make && exif.Model
      ? `${String(exif.Make).trim()} ${String(exif.Model).trim()}`.trim()
      : (exif.Model ?? exif.Make ?? null)

  if (!focalLength && !aperture && !iso && !shutterSpeed && !camera) {
    return null
  }

  return {
    focalLength: focalLength ? String(focalLength) : null,
    aperture,
    iso,
    shutterSpeed,
    camera: camera ? String(camera) : null,
  }
}

async function renderHtml(env: OgEnv, html: string, origin: string): Promise<Uint8Array> {
  // workers-og turns whitespace-only text nodes into children, which trips
  // satori's "div with multiple children needs display:flex" validation.
  const normalized = html.replaceAll(/>\s+</g, '><')
  const fonts = await loadFonts(env, origin)
  if (fonts.length < 2) {
    throw new Error('OG CJK font is unavailable')
  }
  const image = new ImageResponse(normalized, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts,
  })
  return new Uint8Array(await image.arrayBuffer())
}

export async function renderPhotoOgImage(
  env: OgEnv,
  photo: OgPhoto,
  site: OgSiteConfig,
  origin: string,
): Promise<Uint8Array> {
  const thumbnailSrc = await resolvePhotoImage(env, photo, { remaining: MAX_OG_SOURCE_BYTES })
  const formattedDate = formatOgDate(photo.dateTaken)

  const html = buildPhotoOgHtml({
    photoTitle: photo.title || photo.id || 'Untitled Photo',
    siteName: site.name,
    tags: (photo.tags ?? []).slice(0, 3),
    formattedDate,
    exifInfo: buildExifInfo(photo.exif),
    thumbnailSrc,
    photoDimensions: { width: photo.width ?? 1, height: photo.height ?? 1 },
    accentColor: site.accentColor,
  })

  return await renderHtml(env, html, origin)
}

export async function renderHomepageOgImage(
  env: OgEnv,
  site: OgSiteConfig,
  photos: OgPhoto[],
  uniqueCameras: number,
  origin: string,
): Promise<Uint8Array> {
  const budget: ImageBudget = { remaining: MAX_OG_HOMEPAGE_BYTES }
  const featuredPhotos: Array<{ thumbnailSrc: string | null }> = []
  for (const photo of photos.slice(0, 6)) {
    featuredPhotos.push({ thumbnailSrc: await resolvePhotoImage(env, photo, budget) })
  }

  const uniqueTags = new Set<string>()
  for (const photo of photos) {
    for (const tag of photo.tags ?? []) {
      uniqueTags.add(tag)
    }
  }

  const html = buildHomepageOgHtml({
    siteName: site.name,
    siteDescription: site.description || null,
    authorAvatar: await resolveAvatar(site.authorAvatar),
    accentColor: site.accentColor,
    stats: {
      totalPhotos: photos.length,
      uniqueTags: uniqueTags.size,
      uniqueCameras,
    },
    featuredPhotos,
  })

  return await renderHtml(env, html, origin)
}
