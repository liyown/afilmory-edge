import { coreApi, coreApiBaseURL } from '~/lib/api-client'
import { camelCaseKeys } from '~/lib/case'
import { getRequestErrorMessage } from '~/lib/errors'
import { withLanguageHeaderInit } from '~/lib/request-language'

import type {
  BillingUsageOverview,
  PhotoAssetListItem,
  PhotoAssetSummary,
  PhotoSyncAction,
  PhotoSyncConflict,
  PhotoSyncProgressEvent,
  PhotoSyncResolution,
  PhotoSyncResult,
  PhotoSyncStatus,
  RunPhotoSyncPayload,
} from './types'

const STABLE_NEWLINE = /\r?\n/

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
  }
  catch {
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
  const code
    = typeof codeValue === 'number' && Number.isFinite(codeValue)
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

async function readResponseErrorInfo(response: Response): Promise<ServerErrorInfo> {
  try {
    const text = await response.text()
    return extractErrorInfoFromRaw(text)
  }
  catch {
    return { message: null, code: null, raw: null }
  }
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
  response?: { status?: number, _data?: unknown }
} => {
  const error = new Error(info.message ?? fallback) as Error & {
    statusCode?: number
    code?: number
    data?: unknown
    response?: { status?: number, _data?: unknown }
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

type RunPhotoSyncOptions = {
  signal?: AbortSignal
  onEvent?: (event: PhotoSyncProgressEvent) => void
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

export async function runPhotoSync(
  payload: RunPhotoSyncPayload,
  options?: RunPhotoSyncOptions,
): Promise<PhotoSyncResult> {
  const response = await fetch(
    `${coreApiBaseURL}/data-sync/run`,
    withLanguageHeaderInit({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'text/event-stream',
      },
      credentials: 'include',
      body: JSON.stringify({ dryRun: payload.dryRun ?? false }),
      signal: options?.signal,
    }),
  )

  if (!response.ok || !response.body) {
    const fallback = `Sync request failed: ${response.status} ${response.statusText}`
    const errorInfo = await readResponseErrorInfo(response)
    throw createApiError(errorInfo, fallback, response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let finalResult: PhotoSyncResult | null = null
  let lastErrorMessage: string | null = null
  let lastErrorCode: number | null = null

  const stageEvent = (rawEvent: string) => {
    const lines = rawEvent.split(STABLE_NEWLINE)
    let eventName: string | null = null
    const dataLines: string[] = []

    for (const line of lines) {
      if (!line) {
        continue
      }

      if (line.startsWith(':')) {
        continue
      }

      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
        continue
      }

      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      }
    }

    if (!eventName || dataLines.length === 0) {
      return
    }

    if (eventName !== 'progress') {
      return
    }

    const data = dataLines.join('\n')

    try {
      const parsed = JSON.parse(data)
      const event = camelCaseKeys<PhotoSyncProgressEvent>(parsed)

      options?.onEvent?.(event)

      if (event.type === 'complete') {
        finalResult = event.payload
      }

      if (event.type === 'error') {
        lastErrorMessage = event.payload.message
        const payloadCode = (event.payload as { code?: unknown }).code
        if (typeof payloadCode === 'number' && Number.isFinite(payloadCode)) {
          lastErrorCode = payloadCode
        }
        else if (typeof payloadCode === 'string') {
          const parsed = Number.parseInt(payloadCode, 10)
          if (!Number.isNaN(parsed)) {
            lastErrorCode = parsed
          }
        }
      }
    }
    catch (error) {
      console.error('Failed to parse sync progress event', error)
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        stageEvent(rawEvent)
        boundary = buffer.indexOf('\n\n')
      }
    }

    if (buffer.trim().length > 0) {
      stageEvent(buffer)
      buffer = ''
    }
  }
  finally {
    reader.releaseLock()
  }

  if (lastErrorMessage) {
    throw createApiError({ message: lastErrorMessage, code: lastErrorCode, raw: null }, lastErrorMessage)
  }

  if (!finalResult) {
    throw new Error('Sync completed without a final result. Connection terminated.')
  }

  return camelCaseKeys<PhotoSyncResult>(finalResult)
}

export async function listPhotoSyncConflicts(): Promise<PhotoSyncConflict[]> {
  const conflicts = await coreApi<PhotoSyncConflict[]>('/data-sync/conflicts')
  return camelCaseKeys<PhotoSyncConflict[]>(conflicts)
}

export async function resolvePhotoSyncConflict(
  id: string,
  payload: { strategy: PhotoSyncResolution, dryRun?: boolean },
): Promise<PhotoSyncAction> {
  const result = await coreApi<PhotoSyncAction>(`/data-sync/conflicts/${id}/resolve`, {
    method: 'POST',
    body: payload,
  })

  return camelCaseKeys<PhotoSyncAction>(result)
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
  mode: 'single' | 'multipart' | 'proxy'
  key: string
  photoId: string
  headers: Record<string, string>
  url?: string
  uploadId?: string
  parts?: Array<{ partNumber: number, url: string }>
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

async function readImageDimensions(file: File): Promise<{ width: number, height: number } | null> {
  if (!file.type.startsWith('image/')) {
    return null
  }
  try {
    const bitmap = await createImageBitmap(file)
    const dimensions = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return dimensions
  }
  catch {
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
      onProgress: loaded => onProgress(completedBytes + loaded),
    })
    if (!result.etag) {
      throw new Error('R2 did not expose the part ETag. Configure CORS ExposeHeaders: ETag on the bucket.')
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

export async function uploadPhotoAssets(
  files: File[],
  options?: UploadPhotoAssetsOptions,
): Promise<PhotoAssetListItem[]> {
  if (files.length === 0) {
    return []
  }

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
    }
    else {
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

  const uploadObject = async (file: File, index: number): Promise<{ intent: UploadIntent, parts: UploadPart[] }> => {
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

    const parts
      = intent.mode === 'multipart'
        ? await uploadMultipartFile({
            file,
            intent,
            signal: options?.signal,
            timeoutMs: options?.timeoutMs,
            onProgress,
          })
        : await uploadSingleFile({ file, intent, signal: options?.signal, timeoutMs: options?.timeoutMs, onProgress })
    return { intent, parts }
  }

  const uploads: PhotoAssetListItem[] = []
  for (const [index, file] of files.entries()) {
    options?.signal?.throwIfAborted()

    if (pairedVideoIndices.has(index)) {
      // Already uploaded as the companion of the preceding image.
      continue
    }

    if (skippedVideoIndices.has(index)) {
      // A standalone MOV has no gallery representation in the manifest.
      uploadedByFile.set(index, file.size)
      emitProgress()
      continue
    }

    let videoKey: string | null = null
    const videoIndex = videoIndexForImage.get(index)
    if (videoIndex !== undefined && files[videoIndex]) {
      const videoUpload = await uploadObject(files[videoIndex], videoIndex)
      videoKey = videoUpload.intent.key
    }

    const { intent, parts } = await uploadObject(file, index)
    const dimensions = await readImageDimensions(file)
    const asset = await coreApi<PhotoAssetListItem>('/photos/upload-complete', {
      method: 'POST',
      body: {
        key: intent.key,
        photoId: intent.photoId,
        filename: file.name,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        takenAt: Number.isFinite(file.lastModified) ? new Date(file.lastModified).toISOString() : null,
        uploadId: intent.mode === 'multipart' ? intent.uploadId : null,
        parts: parts.length > 0 ? parts : null,
        videoKey,
      },
    })
    uploads.push(asset)
  }

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

export async function getPhotoUsageOverview(options?: { limit?: number }): Promise<BillingUsageOverview> {
  const limit = typeof options?.limit === 'number' ? options.limit : 100
  const response = await coreApi<BillingUsageOverview>('/billing/usage', {
    method: 'GET',
    query: { limit },
  })

  return camelCaseKeys<BillingUsageOverview>(response)
}

export async function getPhotoSyncStatus(): Promise<PhotoSyncStatus> {
  const status = await coreApi<PhotoSyncStatus>('/data-sync/status')
  return camelCaseKeys<PhotoSyncStatus>(status)
}
