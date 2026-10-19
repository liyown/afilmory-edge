import type { PickedExif } from '@afilmory/typing'
import { env as workerEnv } from 'cloudflare:workers'
import exifr from 'exifr'
import { injectable } from 'tsyringe'

// EXIF/XMP lives near the start of JPEG/HEIC/TIFF files. Reading a bounded
// range keeps the Worker from pulling multi-megabyte originals into memory.
const MAX_METADATA_BYTES = 256 * 1024

const EXIF_KEYS = [
  'Orientation',
  'Make',
  'Model',
  'Software',
  'Artist',
  'Copyright',
  'ExposureTime',
  'FNumber',
  'ExposureProgram',
  'ISO',
  'ShutterSpeedValue',
  'ApertureValue',
  'BrightnessValue',
  'ExposureCompensation',
  'MaxApertureValue',
  'LightSource',
  'Flash',
  'FocalLength',
  'FocalLengthIn35mmFormat',
  'LensMake',
  'LensModel',
  'MeteringMode',
  'WhiteBalance',
  'ColorSpace',
  'ExposureMode',
  'SceneCaptureType',
  'Rating',
  'GPSLatitude',
  'GPSLongitude',
  'GPSAltitude',
  'GPSLatitudeRef',
  'GPSLongitudeRef',
  'GPSAltitudeRef',
  'OffsetTime',
  'OffsetTimeOriginal',
  'OffsetTimeDigitized',
] as const

const NON_IMAGE_EXTENSIONS = new Set(['mov', 'mp4', 'm4v', 'avi', 'webm', 'hevc'])

export interface ExtractedMetadata {
  exif: PickedExif | null
  dateTaken: string | null
  keywords: string[]
  width: number | null
  height: number | null
}

const EMPTY_METADATA: ExtractedMetadata = {
  exif: null,
  dateTaken: null,
  keywords: [],
  width: null,
  height: null,
}

function positiveDimension(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }
  return null
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return toIsoString(value)
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue)
  }
  if (value && typeof value === 'object') {
    const candidate = value as { toNumber?: () => number }
    if (typeof candidate.toNumber === 'function') {
      return candidate.toNumber()
    }
  }
  return value
}

function collectKeywords(tags: Record<string, unknown>): string[] {
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const field of ['Subject', 'Keywords', 'HierarchicalSubject', 'WeightedFlatSubject']) {
    const value = tags[field]
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
    for (const entry of list) {
      const keyword = String(entry).trim()
      if (keyword && !seen.has(keyword)) {
        seen.add(keyword)
        keywords.push(keyword)
      }
    }
  }
  return keywords
}

function mapExif(tags: Record<string, unknown>): PickedExif {
  const exif: Record<string, unknown> = {}
  for (const key of EXIF_KEYS) {
    const value = normalizeValue(tags[key])
    if (value !== undefined && value !== null && value !== '') {
      exif[key] = value
    }
  }

  const dateTimeOriginal = toIsoString(tags.DateTimeOriginal)
  const dateTimeDigitized = toIsoString(tags.DateTimeDigitized)
  if (dateTimeOriginal) {
    exif.DateTimeOriginal = dateTimeOriginal
  }
  if (dateTimeDigitized) {
    exif.DateTimeDigitized = dateTimeDigitized
  }

  return exif as unknown as PickedExif
}

@injectable()
export class ExifMetadataService {
  async extract(key: string, extension: string): Promise<ExtractedMetadata> {
    if (NON_IMAGE_EXTENSIONS.has(extension.toLowerCase())) {
      return EMPTY_METADATA
    }

    try {
      const object = await workerEnv.PHOTOS.get(key, {
        range: { offset: 0, length: MAX_METADATA_BYTES },
      })
      if (!object) {
        return EMPTY_METADATA
      }

      const buffer = await object.arrayBuffer()
      const tags = (await exifr.parse(buffer, {
        tiff: true,
        exif: true,
        gps: true,
        xmp: true,
        iptc: true,
        translateValues: true,
        reviveValues: true,
        mergeOutput: true,
      })) as Record<string, unknown> | undefined

      if (!tags) {
        return EMPTY_METADATA
      }

      const dateTaken = toIsoString(tags.DateTimeOriginal) ?? toIsoString(tags.CreateDate)
      return {
        exif: mapExif(tags),
        dateTaken,
        keywords: collectKeywords(tags),
        width: positiveDimension(tags.ExifImageWidth ?? tags.ImageWidth),
        height: positiveDimension(tags.ExifImageHeight ?? tags.ImageHeight),
      }
    }
    catch {
      // Unsupported/corrupt metadata must never block an upload.
      return EMPTY_METADATA
    }
  }
}
