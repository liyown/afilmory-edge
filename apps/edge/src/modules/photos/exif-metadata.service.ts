import type { PhotoRegion, PickedExif } from '@afilmory/typing'
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
  'tz',
  'tzSource',
  'WBShiftAB',
  'WBShiftGM',
  'WhiteBalanceBias',
  'FlashMeteringMode',
  'SensingMethod',
  'FocalPlaneXResolution',
  'FocalPlaneYResolution',
  'Aperture',
  'ScaleFactor35efl',
  'ShutterSpeed',
  'LightValue',
  'GPSCoordinates',
  'MPImageType',
  'UniformResourceName',
] as const

const NON_IMAGE_EXTENSIONS = new Set(['mov', 'mp4', 'm4v', 'avi', 'webm', 'hevc'])

export interface MotionPhotoInfo {
  offset: number
  size: number
  presentationTimestamp?: number
  // Legacy MicroVideoOffset has been seen with both from-start and from-end
  // semantics, so the caller probes the alternate interpretation on mismatch.
  alternateOffset?: number
}

export interface ExtractedMetadata {
  exif: PickedExif | null
  dateTaken: string | null
  keywords: string[]
  regions: PhotoRegion[]
  motionPhoto: MotionPhotoInfo | null
  width: number | null
  height: number | null
}

const EMPTY_METADATA: ExtractedMetadata = {
  exif: null,
  dateTaken: null,
  keywords: [],
  regions: [],
  motionPhoto: null,
  width: null,
  height: null,
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }
  return value === undefined || value === null ? [] : [value]
}

// exiftool emits `W/H/Unit` while exifr keeps the raw XMP `w/h/unit`.
function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = typeof record[key] === 'number' ? record[key] : Number.parseFloat(String(record[key] ?? ''))
    if (typeof parsed === 'number' && Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function normalizeRegionType(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim()
  const groupedType = normalized.match(/\(([^)]+)\)\s*$/)?.[1]?.trim()
  return groupedType || normalized || undefined
}

export function parseRegions(tags: Record<string, unknown>): PhotoRegion[] {
  const source = asRecord(tags.RegionInfo) ?? asRecord(tags.Regions) ?? tags
  if (!source.RegionList) {
    return []
  }

  const dimensions = asRecord(source.AppliedToDimensions)
  const width = dimensions ? readNumber(dimensions, ['W', 'w']) : null
  const height = dimensions ? readNumber(dimensions, ['H', 'h']) : null
  const unit = dimensions && typeof dimensions.Unit === 'string' ? dimensions.Unit : dimensions?.unit
  const appliedToDimensions
    = width !== null && height !== null && typeof unit === 'string' ? { width, height, unit } : null

  return asArray(source.RegionList)
    .map((region) => {
      const record = asRecord(region)
      if (!record) {
        return null
      }
      const name = typeof record.Name === 'string' ? record.Name.trim() : ''
      const type = normalizeRegionType(record.Type)
      const areaRecord = asRecord(record.Area)
      const x = areaRecord ? readNumber(areaRecord, ['X', 'x']) : null
      const y = areaRecord ? readNumber(areaRecord, ['Y', 'y']) : null
      const areaWidth = areaRecord ? readNumber(areaRecord, ['W', 'w']) : null
      const areaHeight = areaRecord ? readNumber(areaRecord, ['H', 'h']) : null
      const area
        = x !== null && y !== null && areaWidth !== null && areaHeight !== null
          ? {
              x,
              y,
              width: areaWidth,
              height: areaHeight,
              unit:
                typeof areaRecord?.Unit === 'string'
                  ? areaRecord.Unit
                  : ((areaRecord?.unit as string | undefined) ?? 'normalized'),
            }
          : null

      if (!name && !type && !area) {
        return null
      }

      return {
        name,
        ...(type ? { type } : {}),
        area,
        appliedToDimensions,
      } satisfies PhotoRegion
    })
    .filter((region): region is PhotoRegion => region !== null)
}

export function parseMotionPhoto(tags: Record<string, unknown>, fileSize: number): MotionPhotoInfo | null {
  const timestamp = readNumber(tags, ['MotionPhotoPresentationTimestampUs', 'MicroVideoPresentationTimestampUs'])

  const directory = asRecord(tags.Directory) ?? asRecord(tags.ContainerDirectory)
  const rawItems = Array.isArray(tags.ContainerDirectory) ? tags.ContainerDirectory : directory?.Item
  for (const entry of asArray(rawItems)) {
    const item = asRecord(asRecord(entry)?.Item ?? entry)
    if (!item || item.Semantic !== 'MotionPhoto') {
      continue
    }
    const length = readNumber(item, ['Length'])
    if (length !== null && length > 0 && length < fileSize) {
      return {
        offset: fileSize - length,
        size: length,
        ...(timestamp !== null ? { presentationTimestamp: timestamp } : {}),
      }
    }
  }

  // Legacy Android MicroVideo format records the distance from the end of the
  // file to the start of the appended MP4.
  const legacyOffset = readNumber(tags, ['MicroVideoOffset'])
  if (legacyOffset !== null && legacyOffset > 0 && legacyOffset < fileSize) {
    return {
      offset: fileSize - legacyOffset,
      size: legacyOffset,
      ...(timestamp !== null ? { presentationTimestamp: timestamp } : {}),
      alternateOffset: legacyOffset,
    }
  }

  return null
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
  // exiftool derives an IANA zone; exifr can only expose the raw offset.
  if (!exif.tz && typeof tags.OffsetTimeOriginal === 'string') {
    exif.tz = tags.OffsetTimeOriginal
    exif.tzSource = 'OffsetTimeOriginal'
  }

  return exif as unknown as PickedExif
}

@injectable()
export class ExifMetadataService {
  async extract(key: string, extension: string, fileSize: number): Promise<ExtractedMetadata> {
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
        regions: parseRegions(tags),
        motionPhoto: parseMotionPhoto(tags, fileSize),
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
