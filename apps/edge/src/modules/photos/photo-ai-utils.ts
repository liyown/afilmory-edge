import type { PhotoAssetManifest } from '@afilmory/db'

const MAX_TAGS = 12
const BLOCKED_TAGS = new Set(['photo', 'image', 'picture', 'photograph', 'jpg', 'jpeg', 'png'])

export interface ParsedVisionOutput {
  caption: string
  tags: string[]
}

interface VisionResult {
  answer?: unknown
  caption?: unknown
  response?: unknown
  choices?: Array<{ message?: { content?: unknown } }>
}

export function thumbnailKeyFor(storageKey: string): string {
  const dotIndex = storageKey.lastIndexOf('.')
  const base = dotIndex > 0 ? storageKey.slice(0, dotIndex) : storageKey
  return `${base}-thumb.jpg`
}

export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const result: string[] = []
  const seen = new Set<string>()
  for (const value of raw) {
    if (typeof value !== 'string') {
      continue
    }
    const tag = value
      .trim()
      .toLowerCase()
      .replaceAll(/[^\p{L}\p{N}\s-]+/gu, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim()
    if (tag.length < 2 || tag.length > 40 || BLOCKED_TAGS.has(tag) || seen.has(tag)) {
      continue
    }
    seen.add(tag)
    result.push(tag)
    if (result.length >= MAX_TAGS) {
      break
    }
  }
  return result
}

export function parseVisionOutput(value: unknown): ParsedVisionOutput | null {
  const text =
    typeof value === 'string'
      ? value
      : typeof (value as VisionResult)?.answer === 'string'
        ? ((value as VisionResult).answer as string)
        : typeof (value as VisionResult)?.caption === 'string'
          ? ((value as VisionResult).caption as string)
          : typeof (value as VisionResult)?.response === 'string'
            ? ((value as VisionResult).response as string)
            : typeof (value as VisionResult)?.choices?.[0]?.message?.content === 'string'
              ? ((value as VisionResult).choices![0].message!.content as string)
              : ''
  const raw = text.trim()
  if (!raw) {
    return null
  }

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as { caption?: unknown; tags?: unknown }
      const caption = typeof parsed.caption === 'string' ? parsed.caption.trim() : ''
      const tags = normalizeTags(parsed.tags)
      if (caption || tags.length > 0) {
        return { caption, tags }
      }
    } catch {
      // Fall through to the caption-only fallback.
    }
  }

  return {
    caption: raw.replaceAll(/^```(?:json)?|```$/g, '').trim(),
    tags: [],
  }
}

export function mergeDisplayTags(manualTags: string[], aiTags: string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const tag of [...manualTags, ...aiTags]) {
    const key = tag.trim().toLowerCase()
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(tag.trim())
  }
  return result
}

export function buildSearchText(manifest: PhotoAssetManifest, caption: string, aiTags: string[]): string {
  const data = manifest.data
  const exif = (data.exif ?? {}) as Record<string, unknown>
  const location = data.location ?? {}
  const locationText = [location.locationName, location.city, location.country]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
  const camera = [exif.Make, exif.Model, exif.LensModel]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')

  return [data.title, caption, ...aiTags, ...(data.tags ?? []), locationText, camera]
    .filter(Boolean)
    .join(' ')
    .slice(0, 8000)
}
