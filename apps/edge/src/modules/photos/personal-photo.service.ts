import type { PhotoAssetManifest } from '@afilmory/db'
import { CURRENT_PHOTO_MANIFEST_VERSION, generateId, photoAiIndex, photoAssets } from '@afilmory/db'
import type { ToneAnalysis, ToneType, VideoSource } from '@afilmory/typing'
import { DbAccessor } from '@core/database/database.provider'
import { asc, eq, inArray } from '@core/database/sql-operators'
import { BizException, ErrorCode } from '@core/errors'
import { ManifestSyncService } from '@core/modules/content/manifest-sync/manifest-sync.service'
import type { PhotoChange } from '@core/modules/content/manifest-sync/manifest-sync.types'
import { injectable } from 'tsyringe'

import { storageDriver, storageProvider, storageProxyPut, storageProxyUploadPart } from '../../storage'
import { ExifMetadataService } from './exif-metadata.service'
import { ManifestPublisher } from './manifest-publisher.service'
import { PhotoAiIndexer } from './photo-ai-indexer'
import type { MultipartPart, UploadIntentResult } from './photo-storage.service'
import { PhotoStorageService } from './photo-storage.service'

const KEY_PREFIX = 'photos'
export const MAX_UPLOAD_FILE_BYTES = 1024 * 1024 * 1024

export interface PhotoAssetSummary {
  total: number
  synced: number
  conflicts: number
  pending: number
}

export interface PhotoAssetListItem {
  id: string
  photoId: string
  storageKey: string
  storageProvider: string
  manifest: PhotoAssetManifest
  syncedAt: string
  updatedAt: string
  createdAt: string
  publicUrl: string | null
  size: number | null
  syncStatus: string
}

export interface UploadIntentInput {
  filename: string
  size: number
  contentType?: string | null
  directory?: string | null
  photoId?: string | null
  variant?: 'original' | 'thumbnail'
}

export interface UploadCompleteInput {
  key: string
  photoId?: string
  filename?: string | null
  width?: number | null
  height?: number | null
  takenAt?: string | null
  thumbHash?: string | null
  toneAnalysis?: ToneAnalysis | null
  uploadId?: string | null
  parts?: MultipartPart[] | null
  videoKey?: string | null
}

function sanitizeSegment(value: string, fallback: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replaceAll(/[^\w.-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 80)
  return cleaned || fallback
}

export function sanitizeDirectory(directory?: string | null): string {
  if (!directory) {
    return ''
  }
  return directory
    .split('/')
    .map((segment) => sanitizeSegment(segment, ''))
    .filter(Boolean)
    .join('/')
}

export function splitFilename(filename: string): { base: string; extension: string } {
  const normalized = filename.split(/[\\/]/).pop() ?? filename
  const dotIndex = normalized.lastIndexOf('.')
  if (dotIndex <= 0) {
    return { base: normalized || 'photo', extension: 'bin' }
  }
  return {
    base: normalized.slice(0, dotIndex) || 'photo',
    extension: normalized.slice(dotIndex + 1).toLowerCase() || 'bin',
  }
}

const CONTENT_TYPES: Record<string, string> = {
  heic: 'image/heic',
  heif: 'image/heif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  dng: 'image/x-adobe-dng',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
}

function contentTypeForFilename(filename: string): string | null {
  return CONTENT_TYPES[splitFilename(filename).extension] ?? null
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

const MP4_SIGNATURE = [0x66, 0x74, 0x79, 0x70] // 'ftyp'

function hasMp4Signature(bytes: Uint8Array): boolean {
  for (let index = 0; index <= bytes.length - MP4_SIGNATURE.length; index += 1) {
    if (MP4_SIGNATURE.every((byte, offset) => bytes[index + offset] === byte)) {
      return true
    }
  }
  return false
}

const TONE_TYPES = new Set<ToneType>(['low-key', 'high-key', 'high-contrast', 'normal'])

function normalizeToneAnalysis(value: unknown): ToneAnalysis | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const input = value as Record<string, unknown>
  const toneType = input.toneType
  if (typeof toneType !== 'string' || !TONE_TYPES.has(toneType as ToneType)) {
    return null
  }

  const brightness = asNumber(input.brightness, Number.NaN)
  const contrast = asNumber(input.contrast, Number.NaN)
  const shadowRatio = asNumber(input.shadowRatio, Number.NaN)
  const highlightRatio = asNumber(input.highlightRatio, Number.NaN)
  if (![brightness, contrast, shadowRatio, highlightRatio].every(Number.isFinite)) {
    return null
  }

  return {
    toneType: toneType as ToneType,
    brightness: Math.min(100, Math.max(0, Math.round(brightness))),
    contrast: Math.min(100, Math.max(0, Math.round(contrast))),
    shadowRatio: Math.min(1, Math.max(0, Math.round(shadowRatio * 100) / 100)),
    highlightRatio: Math.min(1, Math.max(0, Math.round(highlightRatio * 100) / 100)),
  }
}

@injectable()
export class PersonalPhotoService {
  constructor(
    private readonly dbAccessor: DbAccessor,
    private readonly storage: PhotoStorageService,
    private readonly exif: ExifMetadataService,
    private readonly publisher: ManifestPublisher,
    private readonly manifestSync: ManifestSyncService,
    private readonly aiIndexer: PhotoAiIndexer,
  ) {}

  async createUploadIntent(input: UploadIntentInput): Promise<UploadIntentResult & { photoId: string }> {
    if (!input?.filename || typeof input.filename !== 'string') {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'filename is required' })
    }
    if (typeof input.size !== 'number' || !Number.isFinite(input.size) || input.size < 0) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'size is required' })
    }
    if (input.size > MAX_UPLOAD_FILE_BYTES) {
      throw new BizException(ErrorCode.COMMON_PAYLOAD_TOO_LARGE, {
        message: `Files must be ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024 * 1024)}GB or smaller`,
      })
    }

    const requestedPhotoId =
      typeof input.photoId === 'string' && /^\d{6,32}$/.test(input.photoId) ? input.photoId : null
    if (input.variant === 'thumbnail' && !requestedPhotoId) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'photoId is required for thumbnails' })
    }
    const photoId = requestedPhotoId ?? generateId()
    const key =
      input.variant === 'thumbnail'
        ? this.buildThumbnailKey(input.filename, input.directory, photoId)
        : this.buildStorageKey(input.filename, input.directory, photoId)

    const intent = await this.storage.createUploadIntent({
      key,
      size: input.size,
      contentType: input.contentType ?? contentTypeForFilename(input.filename),
    })
    return { ...intent, photoId }
  }

  /**
   * R2 bindings cannot issue presigned URLs, so upload intents point the
   * browser at this same-origin route. The controller guard has already
   * checked the admin session; the body is streamed straight into R2.
   */
  async proxyUpload(request: Request): Promise<Response> {
    if (storageDriver() !== 'r2') {
      return new Response('Not Found', { status: 404 })
    }
    if (request.method !== 'PUT' || !request.body) {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const url = new URL(request.url)
    const prefix = '/api/photos/upload/'
    if (!url.pathname.startsWith(prefix)) {
      return new Response('Not Found', { status: 404 })
    }

    let key: string
    try {
      key = url.pathname
        .slice(prefix.length)
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/')
    } catch {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'Invalid storage key' })
    }
    this.assertStorageKey(key)

    const uploadId = url.searchParams.get('uploadId')
    if (uploadId) {
      const partNumber = Number(url.searchParams.get('partNumber'))
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
        throw new BizException(ErrorCode.COMMON_BAD_REQUEST, {
          message: 'partNumber is required for multipart uploads',
        })
      }
      const etag = await storageProxyUploadPart(key, uploadId, partNumber, request.body)
      return new Response(null, { status: 200, headers: { etag } })
    }

    await storageProxyPut(key, request.body, {
      contentType: request.headers.get('content-type'),
    })
    return new Response(null, { status: 200 })
  }

  async completeUpload(
    input: UploadCompleteInput,
    waitUntil?: (promise: Promise<unknown>) => void,
  ): Promise<PhotoAssetListItem & { change: PhotoChange | null }> {
    if (!input?.key || !input.key.startsWith(`${KEY_PREFIX}/`)) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'key is required' })
    }

    this.assertStorageKey(input.key)

    if (input.uploadId) {
      if (!Array.isArray(input.parts) || input.parts.length === 0) {
        throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'parts are required for multipart uploads' })
      }
      await this.storage.completeMultipartUpload(input.key, input.uploadId, input.parts)
    }

    const db = this.dbAccessor.get()
    const existing = await db.select().from(photoAssets).where(eq(photoAssets.storageKey, input.key)).limit(1)
    if (existing[0]) {
      return await this.finalizeAsset(db, existing[0], waitUntil)
    }

    const object = await this.storage.head(input.key)
    if (!object) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'Uploaded object was not found in S3' })
    }
    this.assertUploadSize(object.size)

    const photoId = input.photoId || generateId()
    const filename = input.filename || input.key.split('/').pop() || photoId
    const lastModified = object.uploaded?.toISOString() ?? new Date().toISOString()
    const { base, extension } = splitFilename(filename)
    const metadata = await this.exif.extract(input.key, extension, object.size)
    const width = Math.max(0, Math.trunc(asNumber(input.width ?? metadata.width, 0)))
    const height = Math.max(0, Math.trunc(asNumber(input.height ?? metadata.height, 0)))
    let video: VideoSource | null = null
    if (input.videoKey) {
      this.assertStorageKey(input.videoKey)
      const videoObject = await this.storage.head(input.videoKey)
      if (!videoObject) {
        throw new BizException(ErrorCode.COMMON_BAD_REQUEST, {
          message: 'Live Photo video was not found in S3',
        })
      }
      this.assertUploadSize(videoObject.size)
      video = {
        type: 'live-photo',
        videoUrl: this.storage.publicUrl(input.videoKey),
        s3Key: input.videoKey,
      }
    } else if (metadata.motionPhoto) {
      // Android Motion Photos embed the MP4 at the end of the original file;
      // the gallery extracts it client-side using this offset and size.
      const candidates = [
        { offset: metadata.motionPhoto.offset, size: metadata.motionPhoto.size },
        ...(metadata.motionPhoto.alternateOffset !== undefined
          ? [{ offset: metadata.motionPhoto.alternateOffset, size: object.size - metadata.motionPhoto.alternateOffset }]
          : []),
      ]
      for (const candidate of candidates) {
        const probe = await this.storage.readRange(input.key, candidate.offset, Math.min(32, candidate.size))
        if (!probe || !hasMp4Signature(probe)) {
          continue
        }
        video = {
          type: 'motion-photo',
          offset: candidate.offset,
          size: candidate.size,
          ...(metadata.motionPhoto.presentationTimestamp !== undefined
            ? { presentationTimestamp: metadata.motionPhoto.presentationTimestamp }
            : {}),
        }
        break
      }
    }

    const originalUrl = this.storage.publicUrl(input.key)
    const thumbnailKey = this.thumbnailKeyFor(input.key)
    const thumbnailObject = await this.storage.head(thumbnailKey)

    const manifest = {
      version: CURRENT_PHOTO_MANIFEST_VERSION,
      data: {
        id: photoId,
        title: base,
        description: '',
        dateTaken: input.takenAt || metadata.dateTaken || lastModified,
        tags: [],
        originalUrl,
        thumbnailUrl: thumbnailObject ? this.storage.publicUrl(thumbnailKey) : this.storage.thumbnailUrl(input.key),
        thumbHash: input.thumbHash ?? null,
        width,
        height,
        aspectRatio: width > 0 && height > 0 ? width / height : 1,
        s3Key: input.key,
        lastModified,
        size: object.size,
        exif: metadata.exif,
        keywords: metadata.keywords,
        regions: metadata.regions,
        toneAnalysis: normalizeToneAnalysis(input.toneAnalysis),
        location: null,
        format: extension.toUpperCase(),
        ...(video ? { video } : {}),
      },
    }

    const inserted = await db
      .insert(photoAssets)
      .values({
        photoId,
        storageKey: input.key,
        storageProvider: storageProvider(),
        size: object.size,
        etag: object.etag ?? null,
        lastModified,
        manifestVersion: CURRENT_PHOTO_MANIFEST_VERSION,
        manifest,
        syncStatus: 'pending',
        syncedAt: lastModified,
      })
      .onConflictDoNothing()
      .returning()

    if (inserted[0]) {
      return await this.finalizeAsset(db, inserted[0], waitUntil)
    }

    const raced = await db.select().from(photoAssets).where(eq(photoAssets.storageKey, input.key)).limit(1)
    if (!raced[0]) {
      throw new BizException(ErrorCode.COMMON_CONFLICT, { message: 'Unable to record the uploaded asset' })
    }
    return await this.finalizeAsset(db, raced[0], waitUntil)
  }

  private async finalizeAsset(
    db: ReturnType<DbAccessor['get']>,
    record: typeof photoAssets.$inferSelect,
    waitUntil?: (promise: Promise<unknown>) => void,
  ): Promise<PhotoAssetListItem & { change: PhotoChange | null }> {
    await this.publisher.publish()

    let finalRecord = record
    if (record.syncStatus !== 'synced') {
      const [synced] = await db
        .update(photoAssets)
        .set({ syncStatus: 'synced', syncedAt: new Date().toISOString() })
        .where(eq(photoAssets.id, record.id))
        .returning()
      finalRecord = synced ?? record
    }

    const change = await this.manifestSync.recordUpsert(finalRecord, this.storage.publicUrl(finalRecord.storageKey))
    const indexing = this.aiIndexer.enqueueAndIndex(finalRecord.id)
    if (waitUntil) {
      waitUntil(indexing)
    } else {
      void indexing
    }
    return { ...this.toListItem(finalRecord), change }
  }

  async reindexAi(limit = 10): Promise<{ queued: number; indexed: number }> {
    const db = this.dbAccessor.get()
    const assets = await db.select({ id: photoAssets.id }).from(photoAssets)
    for (const asset of assets) {
      await this.aiIndexer.ensure(asset.id)
    }
    return { queued: assets.length, indexed: await this.aiIndexer.backfill(limit) }
  }

  async listAssets(): Promise<PhotoAssetListItem[]> {
    const db = this.dbAccessor.get()
    const records = await db.select().from(photoAssets).orderBy(asc(photoAssets.createdAt))
    return records.map((record) => this.toListItem(record))
  }

  async getSummary(): Promise<PhotoAssetSummary> {
    const db = this.dbAccessor.get()
    const records = await db.select({ status: photoAssets.syncStatus }).from(photoAssets)

    const summary: PhotoAssetSummary = { total: records.length, synced: 0, conflicts: 0, pending: 0 }
    for (const record of records) {
      if (record.status === 'synced') {
        summary.synced += 1
      } else if (record.status === 'conflict') {
        summary.conflicts += 1
      } else {
        summary.pending += 1
      }
    }
    return summary
  }

  async updateAssetTags(id: string, tags: string[]): Promise<PhotoAssetListItem & { change: PhotoChange | null }> {
    const db = this.dbAccessor.get()
    const normalized = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)))
    const [record] = await db.select().from(photoAssets).where(eq(photoAssets.id, id)).limit(1)
    if (!record) {
      throw new BizException(ErrorCode.COMMON_NOT_FOUND, { message: 'Photo asset not found' })
    }

    const [ai] = await db
      .select({ tags: photoAiIndex.aiTags })
      .from(photoAiIndex)
      .where(eq(photoAiIndex.photoId, record.photoId))
      .limit(1)
    const aiTags = ai?.tags ?? []
    const aiSet = new Set(aiTags.map((tag) => tag.toLowerCase()))
    const manualTags = normalized.filter((tag) => !aiSet.has(tag.toLowerCase()))
    const mergedTags = Array.from(
      new Map([...manualTags, ...aiTags].map((tag) => [tag.toLowerCase(), tag] as const)).values(),
    )
    const manifest = {
      ...record.manifest,
      data: { ...record.manifest.data, tags: mergedTags },
    }
    const [updated] = await db
      .update(photoAssets)
      .set({ manifest, updatedAt: new Date().toISOString() })
      .where(eq(photoAssets.id, id))
      .returning()
    await this.publisher.publish()
    const change = await this.manifestSync.recordUpsert(updated, this.storage.publicUrl(updated.storageKey))
    return { ...this.toListItem(updated), change }
  }

  async deleteAssets(ids: string[], deleteFromStorage: boolean): Promise<PhotoChange[]> {
    if (ids.length === 0) {
      return []
    }

    const db = this.dbAccessor.get()
    const records = await db
      .select({
        id: photoAssets.id,
        photoId: photoAssets.photoId,
        storageKey: photoAssets.storageKey,
        manifest: photoAssets.manifest,
      })
      .from(photoAssets)
    const targetIds = new Set(ids)
    const targets = records.filter((record) => targetIds.has(record.id))
    if (targets.length === 0) {
      return []
    }

    if (deleteFromStorage) {
      const keys = new Set(targets.map((target) => target.storageKey))
      for (const target of targets) {
        keys.add(this.thumbnailKeyFor(target.storageKey))
        const video = target.manifest?.data?.video
        if (video?.type === 'live-photo') {
          keys.add(video.s3Key)
        }
      }
      await this.storage.delete([...keys])
    }
    await db.delete(photoAssets).where(
      inArray(
        photoAssets.id,
        targets.map((target) => target.id),
      ),
    )
    await db.delete(photoAiIndex).where(
      inArray(
        photoAiIndex.photoId,
        targets.map((target) => target.photoId),
      ),
    )
    await this.aiIndexer.deleteVectors(targets.map((target) => target.photoId))
    await this.publisher.publish()

    return await this.manifestSync.recordDeletes(targets.map((target) => ({ id: target.id, photoId: target.photoId })))
  }

  async getStorageUrl(key: string): Promise<string> {
    if (!key) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'key is required' })
    }
    this.assertStorageKey(key)
    return this.storage.publicUrl(key)
  }

  private buildThumbnailKey(filename: string, directory: string | null | undefined, photoId: string): string {
    const { base } = splitFilename(filename)
    return [KEY_PREFIX, sanitizeDirectory(directory), `${sanitizeSegment(base, 'photo')}-${photoId}-thumb.jpg`]
      .filter(Boolean)
      .join('/')
  }

  private thumbnailKeyFor(storageKey: string): string {
    const dotIndex = storageKey.lastIndexOf('.')
    const base = dotIndex > 0 ? storageKey.slice(0, dotIndex) : storageKey
    return `${base}-thumb.jpg`
  }

  private buildStorageKey(filename: string, directory?: string | null, photoId?: string | null): string {
    const { base, extension } = splitFilename(filename)
    const uniqueSuffix = photoId ? `-${photoId}` : ''
    return [KEY_PREFIX, sanitizeDirectory(directory), `${sanitizeSegment(base, 'photo')}${uniqueSuffix}.${extension}`]
      .filter(Boolean)
      .join('/')
  }

  private assertUploadSize(size: number): void {
    if (size > MAX_UPLOAD_FILE_BYTES) {
      throw new BizException(ErrorCode.COMMON_PAYLOAD_TOO_LARGE, {
        message: `Files must be ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024 * 1024)}GB or smaller`,
      })
    }
  }

  private assertStorageKey(key: string): void {
    if (!key.startsWith(`${KEY_PREFIX}/`) || key.includes('..')) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'Invalid storage key' })
    }
  }

  private toListItem(record: typeof photoAssets.$inferSelect): PhotoAssetListItem {
    return {
      id: record.id,
      photoId: record.photoId,
      storageKey: record.storageKey,
      storageProvider: record.storageProvider,
      manifest: record.manifest,
      syncedAt: record.syncedAt,
      updatedAt: record.updatedAt,
      createdAt: record.createdAt,
      publicUrl: record.storageProvider === 'database-only' ? null : this.storage.publicUrl(record.storageKey),
      size: record.size ?? null,
      syncStatus: record.syncStatus,
    }
  }
}
