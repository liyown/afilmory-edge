import type { PhotoAssetManifest } from '@afilmory/db'
import { CURRENT_PHOTO_MANIFEST_VERSION, generateId, photoAssets } from '@afilmory/db'
import { DbAccessor } from '@core/database/database.provider'
import { asc, eq, inArray } from '@core/database/sql-operators'
import { BizException, ErrorCode } from '@core/errors'
import { ManifestSyncService } from '@core/modules/content/manifest-sync/manifest-sync.service'
import type { PhotoChange } from '@core/modules/content/manifest-sync/manifest-sync.types'
import { injectable } from 'tsyringe'

import { ExifMetadataService } from './exif-metadata.service'
import { ManifestPublisher } from './manifest-publisher.service'
import type { MultipartPart, UploadIntentResult } from './r2-upload.service'
import { R2UploadService } from './r2-upload.service'

const STORAGE_PROVIDER = 'r2'
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
}

export interface UploadCompleteInput {
  key: string
  photoId?: string
  filename?: string | null
  width?: number | null
  height?: number | null
  takenAt?: string | null
  thumbHash?: string | null
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
    .map(segment => sanitizeSegment(segment, ''))
    .filter(Boolean)
    .join('/')
}

export function splitFilename(filename: string): { base: string, extension: string } {
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

@injectable()
export class PersonalPhotoService {
  constructor(
    private readonly dbAccessor: DbAccessor,
    private readonly r2: R2UploadService,
    private readonly exif: ExifMetadataService,
    private readonly publisher: ManifestPublisher,
    private readonly manifestSync: ManifestSyncService,
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

    const photoId = generateId()
    const key = this.buildStorageKey(input.filename, input.directory, photoId)

    const intent = await this.r2.createUploadIntent({
      key,
      size: input.size,
      contentType: input.contentType ?? contentTypeForFilename(input.filename),
    })
    return { ...intent, photoId }
  }

  async completeUpload(input: UploadCompleteInput): Promise<PhotoAssetListItem & { change: PhotoChange | null }> {
    if (!input?.key || !input.key.startsWith(`${KEY_PREFIX}/`)) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'key is required' })
    }

    this.assertStorageKey(input.key)

    if (input.uploadId) {
      if (!Array.isArray(input.parts) || input.parts.length === 0) {
        throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'parts are required for multipart uploads' })
      }
      await this.r2.completeMultipartUpload(input.key, input.uploadId, input.parts)
    }

    const db = this.dbAccessor.get()
    const existing = await db.select().from(photoAssets).where(eq(photoAssets.storageKey, input.key)).limit(1)
    if (existing[0]) {
      return await this.finalizeAsset(db, existing[0])
    }

    const object = await this.r2.head(input.key)
    if (!object) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'Uploaded object was not found in R2' })
    }
    this.assertUploadSize(object.size)

    const photoId = input.photoId || generateId()
    const filename = input.filename || input.key.split('/').pop() || photoId
    const lastModified = object.uploaded?.toISOString() ?? new Date().toISOString()
    const { base, extension } = splitFilename(filename)
    const metadata = await this.exif.extract(input.key, extension)
    const width = Math.max(0, Math.trunc(asNumber(input.width ?? metadata.width, 0)))
    const height = Math.max(0, Math.trunc(asNumber(input.height ?? metadata.height, 0)))
    let video: { type: 'live-photo', videoUrl: string, s3Key: string } | null = null
    if (input.videoKey) {
      this.assertStorageKey(input.videoKey)
      const videoObject = await this.r2.head(input.videoKey)
      if (!videoObject) {
        throw new BizException(ErrorCode.COMMON_BAD_REQUEST, {
          message: 'Live Photo video was not found in R2',
        })
      }
      this.assertUploadSize(videoObject.size)
      video = {
        type: 'live-photo',
        videoUrl: this.r2.publicUrl(input.videoKey),
        s3Key: input.videoKey,
      }
    }

    const originalUrl = this.r2.publicUrl(input.key)

    const manifest = {
      version: CURRENT_PHOTO_MANIFEST_VERSION,
      data: {
        id: photoId,
        title: base,
        description: '',
        dateTaken: input.takenAt || metadata.dateTaken || lastModified,
        tags: [],
        originalUrl,
        thumbnailUrl: this.r2.thumbnailUrl(input.key),
        thumbHash: input.thumbHash ?? null,
        width,
        height,
        aspectRatio: width > 0 && height > 0 ? width / height : 1,
        s3Key: input.key,
        lastModified,
        size: object.size,
        exif: metadata.exif,
        keywords: metadata.keywords,
        regions: [],
        toneAnalysis: null,
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
        storageProvider: STORAGE_PROVIDER,
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
      return await this.finalizeAsset(db, inserted[0])
    }

    const raced = await db.select().from(photoAssets).where(eq(photoAssets.storageKey, input.key)).limit(1)
    if (!raced[0]) {
      throw new BizException(ErrorCode.COMMON_CONFLICT, { message: 'Unable to record the uploaded asset' })
    }
    return await this.finalizeAsset(db, raced[0])
  }

  private async finalizeAsset(
    db: ReturnType<DbAccessor['get']>,
    record: typeof photoAssets.$inferSelect,
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

    const change = await this.manifestSync.recordUpsert(finalRecord, this.r2.publicUrl(finalRecord.storageKey))
    return { ...this.toListItem(finalRecord), change }
  }

  async listAssets(): Promise<PhotoAssetListItem[]> {
    const db = this.dbAccessor.get()
    const records = await db.select().from(photoAssets).orderBy(asc(photoAssets.createdAt))
    return records.map(record => this.toListItem(record))
  }

  async getSummary(): Promise<PhotoAssetSummary> {
    const db = this.dbAccessor.get()
    const records = await db.select({ status: photoAssets.syncStatus }).from(photoAssets)

    const summary: PhotoAssetSummary = { total: records.length, synced: 0, conflicts: 0, pending: 0 }
    for (const record of records) {
      if (record.status === 'synced') {
        summary.synced += 1
      }
      else if (record.status === 'conflict') {
        summary.conflicts += 1
      }
      else {
        summary.pending += 1
      }
    }
    return summary
  }

  async updateAssetTags(id: string, tags: string[]): Promise<PhotoAssetListItem & { change: PhotoChange | null }> {
    const db = this.dbAccessor.get()
    const normalized = Array.from(new Set(tags.map(tag => tag.trim()).filter(Boolean)))
    const [record] = await db.select().from(photoAssets).where(eq(photoAssets.id, id)).limit(1)
    if (!record) {
      throw new BizException(ErrorCode.COMMON_NOT_FOUND, { message: 'Photo asset not found' })
    }

    const manifest = {
      ...record.manifest,
      data: { ...record.manifest.data, tags: normalized },
    }
    const [updated] = await db
      .update(photoAssets)
      .set({ manifest, updatedAt: new Date().toISOString() })
      .where(eq(photoAssets.id, id))
      .returning()
    await this.publisher.publish()
    const change = await this.manifestSync.recordUpsert(updated, this.r2.publicUrl(updated.storageKey))
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
    const targets = records.filter(record => targetIds.has(record.id))
    if (targets.length === 0) {
      return []
    }

    if (deleteFromStorage) {
      const keys = new Set(targets.map(target => target.storageKey))
      for (const target of targets) {
        const video = target.manifest?.data?.video
        if (video?.type === 'live-photo') {
          keys.add(video.s3Key)
        }
      }
      await this.r2.delete([...keys])
    }
    await db.delete(photoAssets).where(
      inArray(
        photoAssets.id,
        targets.map(target => target.id),
      ),
    )
    await this.publisher.publish()

    return await this.manifestSync.recordDeletes(targets.map(target => ({ id: target.id, photoId: target.photoId })))
  }

  async getStorageUrl(key: string): Promise<string> {
    if (!key) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'key is required' })
    }
    this.assertStorageKey(key)
    return this.r2.publicUrl(key)
  }

  async putUploadedObject(key: string, body: ArrayBuffer, contentType?: string | null): Promise<void> {
    this.assertStorageKey(key)
    this.assertUploadSize(body.byteLength)
    await this.r2.put(key, body, contentType)
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
      publicUrl: record.storageProvider === 'database-only' ? null : this.r2.publicUrl(record.storageKey),
      size: record.size ?? null,
      syncStatus: record.syncStatus,
    }
  }
}
