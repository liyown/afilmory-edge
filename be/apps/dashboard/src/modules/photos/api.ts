import { compressUint8Array } from '@afilmory/utils'
import { heicTo } from 'heic-to'
import { rgbaToThumbHash } from 'thumbhash'

import { coreApi } from '~/lib/api-client'
import { camelCaseKeys } from '~/lib/case'
import { getRequestErrorMessage } from '~/lib/errors'

import type { PhotoAssetListItem, PhotoAssetSummary, PhotoSyncProgressEvent } from './types'

const MAX_UPLOAD_FILE_BYTES = 1024 * 1024 * 1024
const MAX_UPLOAD_BATCH_FILES = 128
const MAX_UPLOAD_BATCH_BYTES = 5 * 1024 * 1024 * 1024
const UPLOAD_CONCURRENCY = 3
const THUMBHASH_MAX_DIMENSION = 100
const THUMBNAIL_WIDTH = 600

function normalizeServerMessage(payload: unknown): string | null {
  const message = getRequestErrorMessage(payload, '')
  if (!message) {
    return null
  }
  const trimmed = message.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseRawPayload(raw: string | null | undefined): unknown | null {
  if (!raw) {
    return null
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

type ServerErrorInfo = {
  message: string | null
  code: number | null
  raw: unknown
}

const extractErrorInfoFromPayload = (payload: unknown): ServerErrorInfo => {
  const message = normalizeServerMessage(payload)
  const codeValue = typeof payload === 'object' && payload ? (payload as { code?: unknown }).code : null
  const code =
    typeof codeValue === 'number' && Number.isFinite(codeValue)
      ? codeValue
      : typeof codeValue === 'string'
        ? Number.parseInt(codeValue, 10)
        : null
  return {
    message,
    code: Number.isFinite(code ?? Number.NaN) ? (code as number) : null,
    raw: payload,
  }
}

function extractErrorInfoFromRaw(raw: string | null | undefined): ServerErrorInfo {
  const payload = parseRawPayload(raw)
  return extractErrorInfoFromPayload(payload ?? raw ?? null)
}

function extractErrorInfoFromXhr(xhr: XMLHttpRequest): ServerErrorInfo {
  const raw = typeof xhr.response === 'string' && xhr.response.length > 0 ? xhr.response : (xhr.responseText ?? '')
  return extractErrorInfoFromRaw(raw)
}

const createApiError = (
  info: ServerErrorInfo,
  fallback: string,
  status?: number,
): Error & {
  statusCode?: number
  code?: number
  data?: unknown
  response?: { status?: number; _data?: unknown }
} => {
  const error = new Error(info.message ?? fallback) as Error & {
    statusCode?: number
    code?: number
    data?: unknown
    response?: { status?: number; _data?: unknown }
  }
  if (typeof status === 'number' && Number.isFinite(status)) {
    error.statusCode = status
    error.response = { status }
  }
  if (typeof info.code === 'number') {
    error.code = info.code
  }
  error.data = info.raw
  return error
}

export type PhotoUploadFileProgress = {
  index: number
  name: string
  size: number
  uploadedBytes: number
  progress: number
}

export type PhotoUploadProgressSnapshot = {
  totalBytes: number
  uploadedBytes: number
  files: PhotoUploadFileProgress[]
}

export type UploadPhotoAssetsOptions = {
  directory?: string
  signal?: AbortSignal
  onProgress?: (snapshot: PhotoUploadProgressSnapshot) => void
  timeoutMs?: number
  onServerEvent?: (event: PhotoSyncProgressEvent) => void
}

export async function listPhotoAssets(): Promise<PhotoAssetListItem[]> {
  const assets = await coreApi<PhotoAssetListItem[]>('/photos/assets')

  return assets
}

export async function getPhotoAssetSummary(): Promise<PhotoAssetSummary> {
  const summary = await coreApi<PhotoAssetSummary>('/photos/assets/summary')

  return camelCaseKeys<PhotoAssetSummary>(summary)
}

export async function deletePhotoAssets(ids: string[], options?: { deleteFromStorage?: boolean }): Promise<void> {
  await coreApi('/photos/assets', {
    method: 'DELETE',
    body: {
      ids,
      deleteFromStorage: options?.deleteFromStorage === true,
    },
  })
}

export async function updatePhotoAssetTags(id: string, tags: string[]): Promise<PhotoAssetListItem> {
  const asset = await coreApi<PhotoAssetListItem>(`/photos/assets/${id}/tags`, {
    method: 'PATCH',
    body: { tags },
  })

  return camelCaseKeys<PhotoAssetListItem>(asset)
}

type UploadIntent = {
  mode: 'single' | 'multipart'
  key: string
  photoId: string
  headers: Record<string, string>
  url?: string
  uploadId?: string
  parts?: Array<{ partNumber: number; url: string }>
}

type UploadPart = {
  partNumber: number
  etag: string
}

type PutResult = {
  etag: string | null
}

function putBlobWithProgress(params: {
  url: string
  blob: Blob
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (loaded: number) => void
}): Promise<PutResult> {
  const { url, blob, headers, signal, timeoutMs, onProgress } = params
  return new Promise<PutResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const sameOrigin = url.startsWith('/')
    xhr.open('PUT', url, true)
    xhr.withCredentials = sameOrigin
    if (timeoutMs && Number.isFinite(timeoutMs)) {
      xhr.timeout = Math.max(0, timeoutMs)
    }
    for (const [name, value] of Object.entries(headers ?? {})) {
      xhr.setRequestHeader(name, value)
    }

    const handleAbort = () => xhr.abort()
    const cleanup = () => signal?.removeEventListener('abort', handleAbort)
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', handleAbort)
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded)
      }
    }
    xhr.onerror = () => {
      cleanup()
      reject(
        createApiError(
          { message: 'Network error during upload. Please try again later.', code: null, raw: null },
          'Network error during upload. Please try again later.',
          xhr.status || undefined,
        ),
      )
    }
    xhr.onabort = () => {
      cleanup()
      reject(new DOMException('Upload aborted', 'AbortError'))
    }
    xhr.ontimeout = () => {
      cleanup()
      reject(
        createApiError(
          { message: 'Upload timed out. Please try again later.', code: null, raw: null },
          'Upload timed out. Please try again later.',
          xhr.status || undefined,
        ),
      )
    }
    xhr.onload = () => {
      cleanup()
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(blob.size)
        resolve({ etag: xhr.getResponseHeader('etag') })
        return
      }
      reject(createApiError(extractErrorInfoFromXhr(xhr), `Upload failed: ${xhr.status}`, xhr.status || undefined))
    }
    xhr.send(blob)
  })
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function validateUploadBatch(files: File[]): void {
  if (files.length > MAX_UPLOAD_BATCH_FILES) {
    throw new Error(`一次最多上传 ${MAX_UPLOAD_BATCH_FILES} 个文件`)
  }
  for (const file of files) {
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      throw new Error(`文件 ${file.name} 超过单文件上限 ${formatBytes(MAX_UPLOAD_FILE_BYTES)}`)
    }
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_UPLOAD_BATCH_BYTES) {
    throw new Error(`本批次总大小超过上限 ${formatBytes(MAX_UPLOAD_BATCH_BYTES)}`)
  }
}

type ToneType = 'low-key' | 'high-key' | 'high-contrast' | 'normal'

type ToneAnalysis = {
  toneType: ToneType
  brightness: number
  contrast: number
  shadowRatio: number
  highlightRatio: number
}

type ImageInspection = {
  width: number
  height: number
  thumbHash: string | null
  toneAnalysis: ToneAnalysis | null
  thumbnail: Blob | null
}

/** Derives tone analysis from a 100px thumbnail histogram. */
function analyzeTone(data: Uint8ClampedArray): ToneAnalysis | null {
  const pixelCount = data.length / 4
  if (pixelCount === 0) {
    return null
  }

  const luminance = Array.from<number>({ length: 256 }).fill(0)
  for (let index = 0; index < data.length; index += 4) {
    const value = Math.round(0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2])
    luminance[value]++
  }

  let totalLuminance = 0
  for (let value = 0; value < luminance.length; value++) {
    totalLuminance += value * luminance[value]
  }
  const mean = totalLuminance / pixelCount
  const brightness = Math.round(mean * (100 / 255))

  let shadowRatio = 0
  let highlightRatio = 0
  for (let value = 0; value < 86; value++) {
    shadowRatio += luminance[value]
  }
  for (let value = 170; value < 256; value++) {
    highlightRatio += luminance[value]
  }
  shadowRatio /= pixelCount
  highlightRatio /= pixelCount

  let variance = 0
  for (let value = 0; value < luminance.length; value++) {
    variance += luminance[value] * (value - mean) ** 2
  }
  variance /= pixelCount
  const contrast = Math.min(100, Math.round((Math.sqrt(variance) / 127.5) * 100))

  let toneType: ToneType
  if (brightness < 30 && shadowRatio > 0.6) {
    toneType = 'low-key'
  } else if (brightness > 70 && highlightRatio > 0.6) {
    toneType = 'high-key'
  } else if (contrast > 60 && shadowRatio > 0.3 && highlightRatio > 0.3) {
    toneType = 'high-contrast'
  } else {
    toneType = 'normal'
  }

  return {
    toneType,
    brightness,
    contrast,
    shadowRatio: Math.round(shadowRatio * 100) / 100,
    highlightRatio: Math.round(highlightRatio * 100) / 100,
  }
}

const HEIC_EXTENSIONS = new Set(['heic', 'heif', 'hif'])

async function decodeImage(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file)
  } catch {
    if (!HEIC_EXTENSIONS.has(fileExtension(file.name))) {
      return null
    }
  }

  // Chrome cannot decode HEIC natively; convert it the same way the public
  // gallery does so dimensions, ThumbHash and tone analysis stay available.
  try {
    const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 })
    return await createImageBitmap(jpeg)
  } catch {
    return null
  }
}

async function inspectImage(file: File): Promise<ImageInspection | null> {
  if (file.type && !file.type.startsWith('image/') && !HEIC_EXTENSIONS.has(fileExtension(file.name))) {
    return null
  }
  const bitmap = await decodeImage(file)
  if (!bitmap) {
    return null
  }

  try {
    const dimensions = { width: bitmap.width, height: bitmap.height }
    const scale = Math.min(1, THUMBHASH_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) {
      return { ...dimensions, thumbHash: null, toneAnalysis: null, thumbnail: null }
    }

    context.drawImage(bitmap, 0, 0, width, height)
    const { data } = context.getImageData(0, 0, width, height)
    return {
      ...dimensions,
      thumbHash: compressUint8Array(rgbaToThumbHash(width, height, data)),
      toneAnalysis: analyzeTone(data),
      thumbnail: await renderThumbnail(bitmap),
    }
  } catch {
    return { width: bitmap.width, height: bitmap.height, thumbHash: null, toneAnalysis: null, thumbnail: null }
  } finally {
    bitmap.close()
  }
}

async function renderThumbnail(bitmap: ImageBitmap): Promise<Blob | null> {
  try {
    const scale = Math.min(1, THUMBNAIL_WIDTH / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }
    context.drawImage(bitmap, 0, 0, width, height)
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
  } catch {
    return null
  }
}

async function uploadSingleFile(params: {
  file: File
  intent: UploadIntent
  signal?: AbortSignal
  timeoutMs?: number
  onProgress: (loaded: number) => void
}): Promise<UploadPart[]> {
  const { file, intent, signal, timeoutMs, onProgress } = params
  if (!intent.url) {
    throw new Error('Upload intent did not include a URL')
  }

  await putBlobWithProgress({
    url: intent.url,
    blob: file,
    headers: intent.headers,
    signal,
    timeoutMs,
    onProgress,
  })
  return []
}

async function uploadMultipartFile(params: {
  file: File
  intent: UploadIntent
  signal?: AbortSignal
  timeoutMs?: number
  onProgress: (loaded: number) => void
}): Promise<UploadPart[]> {
  const { file, intent, signal, timeoutMs, onProgress } = params
  const parts = intent.parts ?? []
  if (parts.length === 0) {
    throw new Error('Multipart upload intent did not include parts')
  }

  const partSize = Math.ceil(file.size / parts.length)
  const uploaded: UploadPart[] = []
  let completedBytes = 0

  for (const part of parts) {
    const start = (part.partNumber - 1) * partSize
    const end = Math.min(file.size, start + partSize)
    const blob = file.slice(start, end)
    const result = await putBlobWithProgress({
      url: part.url,
      blob,
      headers: intent.headers,
      signal,
      timeoutMs,
      onProgress: (loaded) => onProgress(completedBytes + loaded),
    })
    if (!result.etag) {
      throw new Error('S3 did not expose the part ETag. Configure CORS ExposeHeaders: ETag on the bucket.')
    }
    uploaded.push({ partNumber: part.partNumber, etag: result.etag })
    completedBytes += blob.size
    onProgress(completedBytes)
  }

  return uploaded
}

const IMAGE_UPLOAD_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tiff',
  'tif',
  'heic',
  'heif',
  'hif',
  'avif',
  'raw',
  'dng',
])

function fileExtension(name: string): string {
  const normalized = name.toLowerCase()
  const dotIndex = normalized.lastIndexOf('.')
  return dotIndex === -1 ? '' : normalized.slice(dotIndex + 1)
}

function fileBaseName(name: string): string {
  const dotIndex = name.lastIndexOf('.')
  return (dotIndex === -1 ? name : name.slice(0, dotIndex)).toLowerCase()
}

export type PhotoUploadFailure = {
  index: number
  /** The failed image plus its Live Photo video, when one was paired. */
  indices: number[]
  name: string
  message: string
}

export class PhotoUploadBatchError extends Error {
  readonly failures: PhotoUploadFailure[]
  readonly succeeded: number

  constructor(failures: PhotoUploadFailure[], succeeded: number) {
    const details = failures
      .slice(0, 3)
      .map((failure) => (failure.message ? `${failure.name}（${failure.message}）` : failure.name))
      .join('、')
    const suffix = failures.length > 3 ? ` 等 ${failures.length} 个文件` : ''
    super(`${failures.length} 个文件上传失败${succeeded > 0 ? `，${succeeded} 个已成功` : ''}：${details}${suffix}`)
    this.name = 'PhotoUploadBatchError'
    this.failures = failures
    this.succeeded = succeeded
  }
}

export async function uploadPhotoAssets(
  files: File[],
  options?: UploadPhotoAssetsOptions,
): Promise<PhotoAssetListItem[]> {
  if (files.length === 0) {
    return []
  }

  validateUploadBatch(files)

  // iOS Live Photos arrive as <base>.HEIC + <base>.MOV. Pair them by base
  // name; the MOV is uploaded as the photo's companion, not as its own asset.
  const imageIndexByBase = new Map<string, number>()
  files.forEach((file, index) => {
    if (IMAGE_UPLOAD_EXTENSIONS.has(fileExtension(file.name))) {
      imageIndexByBase.set(fileBaseName(file.name), index)
    }
  })
  const videoIndexForImage = new Map<number, number>()
  const pairedVideoIndices = new Set<number>()
  const skippedVideoIndices = new Set<number>()
  files.forEach((file, index) => {
    if (fileExtension(file.name) !== 'mov') {
      return
    }
    const imageIndex = imageIndexByBase.get(fileBaseName(file.name))
    if (imageIndex === undefined) {
      skippedVideoIndices.add(index)
    } else {
      videoIndexForImage.set(imageIndex, index)
      pairedVideoIndices.add(index)
    }
  })

  const fileMetadata = files.map((file, index) => ({ index, name: file.name, size: file.size }))
  const totalBytes = fileMetadata.reduce((sum, file) => sum + file.size, 0)
  const uploadedByFile = new Map<number, number>()

  const emitProgress = () => {
    if (!options?.onProgress) {
      return
    }
    const filesProgress: PhotoUploadFileProgress[] = fileMetadata.map((meta) => {
      const uploadedBytes = Math.min(meta.size, uploadedByFile.get(meta.index) ?? 0)
      return {
        index: meta.index,
        name: meta.name,
        size: meta.size,
        uploadedBytes,
        progress: meta.size === 0 ? 1 : uploadedBytes / meta.size,
      }
    })
    const uploadedBytes = filesProgress.reduce((sum, file) => sum + file.uploadedBytes, 0)
    options.onProgress({ totalBytes, uploadedBytes: Math.min(uploadedBytes, totalBytes), files: filesProgress })
  }

  const uploadObject = async (file: File, index: number): Promise<{ intent: UploadIntent; parts: UploadPart[] }> => {
    const intent = await coreApi<UploadIntent>('/photos/upload-intent', {
      method: 'POST',
      body: {
        filename: file.name,
        size: file.size,
        contentType: file.type || null,
        directory: options?.directory ?? null,
      },
    })

    const onProgress = (loaded: number) => {
      uploadedByFile.set(index, loaded)
      emitProgress()
    }

    const parts =
      intent.mode === 'multipart'
        ? await uploadMultipartFile({
            file,
            intent,
            signal: options?.signal,
            timeoutMs: options?.timeoutMs,
            onProgress,
          })
        : await uploadSingleFile({
            file,
            intent,
            signal: options?.signal,
            timeoutMs: options?.timeoutMs,
            onProgress,
          })
    return { intent, parts }
  }

  // Separate 600px JPEG keeps the gallery from loading full-size originals on
  // deployments without an image-resizing endpoint (workers.dev, local dev).
  const uploadThumbnail = async (photoId: string, file: File, thumbnail: Blob): Promise<void> => {
    try {
      const thumbnailFile = new File([thumbnail], file.name, { type: 'image/jpeg' })
      const intent = await coreApi<UploadIntent>('/photos/upload-intent', {
        method: 'POST',
        body: {
          filename: file.name,
          size: thumbnailFile.size,
          contentType: 'image/jpeg',
          directory: options?.directory ?? null,
          photoId,
          variant: 'thumbnail',
        },
      })
      await uploadSingleFile({
        file: thumbnailFile,
        intent,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
        onProgress: () => {},
      })
    } catch (error) {
      console.warn('Thumbnail upload failed; falling back to the original image', error)
    }
  }

  const uploadTaskIndices: number[] = []
  files.forEach((file, index) => {
    if (pairedVideoIndices.has(index)) {
      // Already uploaded as the companion of the preceding image.
      return
    }
    if (skippedVideoIndices.has(index)) {
      // A standalone MOV has no gallery representation in the manifest.
      uploadedByFile.set(index, file.size)
      return
    }
    uploadTaskIndices.push(index)
  })
  emitProgress()

  const results: Array<{ index: number; asset: PhotoAssetListItem }> = []
  const failures: PhotoUploadFailure[] = []
  let nextTask = 0

  // Each completion rewrites the full manifest. Upload bytes concurrently,
  // but finalize one asset at a time so two completions cannot publish
  // snapshots that overwrite each other.
  let completionLock = Promise.resolve()
  const withCompletionLock = async <T>(task: () => Promise<T>): Promise<T> => {
    const previous = completionLock
    let release = () => {}
    completionLock = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      options?.signal?.throwIfAborted()
      return await task()
    } finally {
      release()
    }
  }

  const runUploadTask = async (index: number): Promise<PhotoAssetListItem> => {
    const file = files[index]
    options?.signal?.throwIfAborted()

    let videoKey: string | null = null
    const videoIndex = videoIndexForImage.get(index)
    if (videoIndex !== undefined && files[videoIndex]) {
      const videoUpload = await uploadObject(files[videoIndex], videoIndex)
      videoKey = videoUpload.intent.key
    }

    const inspection = await inspectImage(file)
    const { intent, parts } = await uploadObject(file, index)
    if (inspection?.thumbnail) {
      await uploadThumbnail(intent.photoId, file, inspection.thumbnail)
    }
    return await withCompletionLock(() =>
      coreApi<PhotoAssetListItem>('/photos/upload-complete', {
        method: 'POST',
        body: {
          key: intent.key,
          photoId: intent.photoId,
          filename: file.name,
          width: inspection?.width ?? null,
          height: inspection?.height ?? null,
          thumbHash: inspection?.thumbHash ?? null,
          toneAnalysis: inspection?.toneAnalysis ?? null,
          takenAt: Number.isFinite(file.lastModified) ? new Date(file.lastModified).toISOString() : null,
          uploadId: intent.mode === 'multipart' ? intent.uploadId : null,
          parts: parts.length > 0 ? parts : null,
          videoKey,
        },
      }),
    )
  }

  const runUploadWorker = async (): Promise<void> => {
    while (!options?.signal?.aborted) {
      const taskPosition = nextTask++
      if (taskPosition >= uploadTaskIndices.length) {
        return
      }
      const index = uploadTaskIndices[taskPosition]
      try {
        const asset = await runUploadTask(index)
        results.push({ index, asset })
      } catch (error) {
        if (options?.signal?.aborted) {
          return
        }
        const videoIndex = videoIndexForImage.get(index)
        failures.push({
          index,
          indices: videoIndex === undefined ? [index] : [index, videoIndex],
          name: files[index].name,
          message: error instanceof Error ? error.message : '上传失败',
        })
      }
    }
  }

  const workerCount = Math.min(UPLOAD_CONCURRENCY, uploadTaskIndices.length)
  await Promise.all(Array.from({ length: workerCount }, runUploadWorker))

  options?.signal?.throwIfAborted()

  if (failures.length > 0) {
    failures.sort((left, right) => left.index - right.index)
    throw new PhotoUploadBatchError(failures, results.length)
  }

  const uploads = results.sort((left, right) => left.index - right.index).map((result) => result.asset)

  uploadedByFile.forEach((_value, index) => uploadedByFile.set(index, files[index].size))
  emitProgress()

  const uploadedObjects = files.length - skippedVideoIndices.size
  const databaseRecords = uploads.length

  // The upload UI waits for a processing `complete` event to leave the
  // uploading phase. Metadata/manifest work now happens inline, so report a
  // completed sync rather than depending on the removed SSE endpoint.
  options?.onServerEvent?.({
    type: 'start',
    payload: {
      summary: {
        storageObjects: uploadedObjects,
        databaseRecords,
        inserted: 0,
        updated: 0,
        deleted: 0,
        conflicts: 0,
        skipped: skippedVideoIndices.size,
        errors: 0,
      },
      totals: {
        'missing-in-db': files.length,
        'orphan-in-db': 0,
        'metadata-conflicts': 0,
        'status-reconciliation': 0,
      },
      options: { dryRun: false },
    },
  })
  options?.onServerEvent?.({
    type: 'complete',
    payload: {
      summary: {
        storageObjects: uploadedObjects,
        databaseRecords,
        inserted: databaseRecords,
        updated: 0,
        deleted: 0,
        conflicts: 0,
        skipped: skippedVideoIndices.size,
        errors: 0,
      },
      actions: [],
    },
  })

  return uploads
}

export async function getPhotoStorageUrl(storageKey: string): Promise<string> {
  const result = await coreApi<{ url: string }>('/photos/storage-url', {
    method: 'GET',
    query: { key: storageKey },
  })

  const data = camelCaseKeys<{ url: string }>(result)

  return data.url
}
