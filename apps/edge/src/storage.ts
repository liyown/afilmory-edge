// Object storage facade. Two drivers share one API:
// - `s3`: any S3-compatible service (Aliyun OSS for the manual deployment),
//   using presigned uploads.
// - `r2`: the native R2 binding from the one-click Cloudflare deployment.
//   Bindings cannot presign, so uploads are proxied through the Worker.
// Photos, the rendered manifest, OG cards, and D1 backups all live in one
// private bucket; media is served through the Worker's `/media/*` proxy.

import { env } from '@afilmory/env'
import { AwsClient } from 'aws4fetch'

const LIST_PAGE_SIZE = 1000
const DELETE_CONCURRENCY = 8
const PUBLIC_MEDIA_PREFIX = '/media'
const UPLOAD_PROXY_PREFIX = '/api/photos/upload'

export type StorageDriverKind = 's3' | 'r2'
export type StorageProvider = 'oss' | 'r2'

export interface StorageObjectInfo {
  key: string
  size: number
  etag?: string
  uploaded?: Date
}

export interface StorageObject {
  response: Response
  size: number
}

export interface MultipartPart {
  partNumber: number
  etag: string
}

function configured(value: string | undefined): string | undefined {
  return value && value !== 'disabled' ? value : undefined
}

function requireSetting(name: string, value: string | undefined): string {
  const normalized = configured(value)
  if (!normalized) {
    throw new Error(`S3 storage is not configured: ${name} is missing`)
  }
  return normalized
}

function r2Bucket(): R2Bucket | undefined {
  return (env.PHOTOS as R2Bucket | undefined) ?? undefined
}

function requireR2(): R2Bucket {
  const bucket = r2Bucket()
  if (!bucket) {
    throw new Error('R2 storage is not configured: the PHOTOS binding is missing')
  }
  return bucket
}

export function storageDriver(): StorageDriverKind {
  if (env.STORAGE_DRIVER === 'r2') {
    return 'r2'
  }
  if (env.STORAGE_DRIVER === 's3') {
    return 's3'
  }
  return r2Bucket() ? 'r2' : 's3'
}

export function storageProvider(): StorageProvider {
  return storageDriver() === 'r2' ? 'r2' : 'oss'
}

export function isStorageConfigured(): boolean {
  if (storageDriver() === 'r2') {
    return Boolean(r2Bucket())
  }
  return Boolean(
    configured(env.S3_ENDPOINT) &&
    configured(env.S3_REGION) &&
    configured(env.S3_ACCESS_KEY_ID) &&
    configured(env.S3_SECRET_ACCESS_KEY),
  )
}

function client(): AwsClient {
  return new AwsClient({
    accessKeyId: requireSetting('S3_ACCESS_KEY_ID', env.S3_ACCESS_KEY_ID),
    secretAccessKey: requireSetting('S3_SECRET_ACCESS_KEY', env.S3_SECRET_ACCESS_KEY),
    service: 's3',
    region: requireSetting('S3_REGION', env.S3_REGION),
  })
}

function endpoint(): string {
  return requireSetting('S3_ENDPOINT', env.S3_ENDPOINT).replace(/\/+$/, '')
}

export function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** Virtual-hosted-style bucket URL; the endpoint must already include the bucket. */
function objectUrl(key: string): URL {
  return new URL(`${endpoint()}/${encodeKeyPath(key)}`)
}

export function mediaUrl(key: string): string {
  return `${PUBLIC_MEDIA_PREFIX}/${encodeKeyPath(key)}`
}

/**
 * S3: a signed bucket URL. R2: a same-origin Worker route; the browser uploads
 * with its session cookie and the Worker streams the body into the binding.
 */
export async function presignStorageUrl(method: string, key: string, query?: Record<string, string>): Promise<string> {
  if (storageDriver() === 'r2') {
    const params = new URLSearchParams(query ?? {})
    const search = params.size > 0 ? `?${params.toString()}` : ''
    return `${UPLOAD_PROXY_PREFIX}/${encodeKeyPath(key)}${search}`
  }

  const url = objectUrl(key)
  url.searchParams.set('X-Amz-Expires', '3600')
  for (const [name, value] of Object.entries(query ?? {})) {
    url.searchParams.set(name, value)
  }

  const signed = await client().sign(url.toString(), { method, aws: { signQuery: true } })
  return signed.url
}

export async function signedStorageFetch(
  key: string,
  init: RequestInit = {},
  query?: Record<string, string>,
): Promise<Response> {
  if (storageDriver() === 'r2') {
    throw new Error('signedStorageFetch is only available for S3 storage')
  }

  const url = objectUrl(key)
  for (const [name, value] of Object.entries(query ?? {})) {
    url.searchParams.set(name, value)
  }
  return await client().fetch(url.toString(), init)
}

export async function storageHead(key: string): Promise<StorageObjectInfo | null> {
  if (storageDriver() === 'r2') {
    const object = await requireR2().head(key)
    if (!object) {
      return null
    }
    return {
      key,
      size: object.size,
      etag: normalizeEtag(object.etag),
      uploaded: object.uploaded,
    }
  }

  // OSS can briefly return 403 for a freshly uploaded object. Retry HEAD a
  // few times before surfacing the failure to the upload client.
  const retryDelays = [200, 600, 1200]
  for (let attempt = 0; ; attempt += 1) {
    const response = await client().fetch(objectUrl(key).toString(), { method: 'HEAD' })
    if (response.status === 404) {
      return null
    }
    if (response.ok) {
      return {
        key,
        size: Number(response.headers.get('content-length') ?? 0),
        etag: normalizeEtag(response.headers.get('etag')),
        uploaded: parseDate(response.headers.get('last-modified')),
      }
    }
    if (
      (response.status === 403 || response.status === 408 || response.status === 429 || response.status >= 500) &&
      attempt < retryDelays.length
    ) {
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]))
      continue
    }
    throw new Error(`S3 HEAD ${key} failed: ${response.status} ${await safeText(response)}`)
  }
}

export async function storageGet(
  key: string,
  range?: { offset: number; length: number },
): Promise<StorageObject | null> {
  if (storageDriver() === 'r2') {
    const object = await requireR2().get(
      key,
      range ? { range: { offset: range.offset, length: range.length } } : undefined,
    )
    if (!object) {
      return null
    }

    const headers = new Headers()
    if (object.httpMetadata?.contentType) {
      headers.set('content-type', object.httpMetadata.contentType)
    }
    if (object.httpMetadata?.cacheControl) {
      headers.set('cache-control', object.httpMetadata.cacheControl)
    }
    if (object.etag) {
      headers.set('etag', object.httpEtag)
    }
    headers.set('accept-ranges', 'bytes')
    if (range) {
      const end = range.offset + Math.min(range.length, object.size - range.offset) - 1
      headers.set('content-range', `bytes ${range.offset}-${end}/${object.size}`)
      headers.set('content-length', String(end - range.offset + 1))
    }

    return {
      response: new Response(object.body, { headers }),
      size: object.size,
    }
  }

  const headers: Record<string, string> = {}
  if (range) {
    headers.range = `bytes=${range.offset}-${range.offset + range.length - 1}`
  }

  const response = await client().fetch(objectUrl(key).toString(), { headers })
  if (response.status === 404) {
    return null
  }
  if (!response.ok && response.status !== 206) {
    throw new Error(`S3 GET ${key} failed: ${response.status} ${await safeText(response)}`)
  }

  return {
    response,
    size: Number(response.headers.get('content-length') ?? 0),
  }
}

export interface PutObjectOptions {
  contentType?: string | null
  cacheControl?: string | null
  metadata?: Record<string, string>
}

export async function storagePut(
  key: string,
  body: string | ArrayBuffer | Uint8Array,
  options?: PutObjectOptions,
): Promise<void> {
  if (storageDriver() === 'r2') {
    await requireR2().put(key, body, {
      httpMetadata: {
        contentType: options?.contentType ?? undefined,
        cacheControl: options?.cacheControl ?? undefined,
      },
      customMetadata: options?.metadata,
    })
    return
  }

  const headers: Record<string, string> = {}
  if (options?.contentType) {
    headers['content-type'] = options.contentType
  }
  if (options?.cacheControl) {
    headers['cache-control'] = options.cacheControl
  }
  for (const [name, value] of Object.entries(options?.metadata ?? {})) {
    headers[`x-amz-meta-${name.toLowerCase()}`] = value
  }

  const response = await client().fetch(objectUrl(key).toString(), { method: 'PUT', headers, body })
  if (!response.ok) {
    throw new Error(`S3 PUT ${key} failed: ${response.status} ${await safeText(response)}`)
  }
}

/** Streams a proxied upload body into R2 without buffering it in memory. */
export async function storageProxyPut(key: string, body: ReadableStream, options?: PutObjectOptions): Promise<void> {
  await requireR2().put(key, body, {
    httpMetadata: {
      contentType: options?.contentType ?? undefined,
      cacheControl: options?.cacheControl ?? undefined,
    },
    customMetadata: options?.metadata,
  })
}

export async function storageCreateMultipartUpload(key: string, options?: PutObjectOptions): Promise<string> {
  const upload = await requireR2().createMultipartUpload(key, {
    httpMetadata: { contentType: options?.contentType ?? undefined },
  })
  return upload.uploadId
}

export async function storageProxyUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  body: ReadableStream,
): Promise<string> {
  const part = await requireR2().resumeMultipartUpload(key, uploadId).uploadPart(partNumber, body)
  return part.etag
}

export async function storageProxyCompleteMultipart(
  key: string,
  uploadId: string,
  parts: MultipartPart[],
): Promise<void> {
  await requireR2()
    .resumeMultipartUpload(key, uploadId)
    .complete(
      parts
        .slice()
        .sort((left, right) => left.partNumber - right.partNumber)
        .map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
    )
}

export async function storageDelete(keys: string[]): Promise<void> {
  if (storageDriver() === 'r2') {
    if (keys.length > 0) {
      await requireR2().delete(keys)
    }
    return
  }

  for (let index = 0; index < keys.length; index += DELETE_CONCURRENCY) {
    await Promise.all(
      keys.slice(index, index + DELETE_CONCURRENCY).map(async (key) => {
        const response = await client().fetch(objectUrl(key).toString(), { method: 'DELETE' })
        if (!response.ok && response.status !== 404) {
          throw new Error(`S3 DELETE ${key} failed: ${response.status} ${await safeText(response)}`)
        }
      }),
    )
  }
}

export interface StorageListPage {
  objects: StorageObjectInfo[]
  nextToken?: string
}

export async function storageListPage(
  prefix: string,
  limit = LIST_PAGE_SIZE,
  continuationToken?: string,
): Promise<StorageListPage> {
  if (storageDriver() === 'r2') {
    const page = await requireR2().list({ prefix, limit, cursor: continuationToken })
    return {
      objects: page.objects.map((object) => ({
        key: object.key,
        size: object.size,
        etag: normalizeEtag(object.etag),
        uploaded: object.uploaded,
      })),
      nextToken: page.truncated ? page.cursor : undefined,
    }
  }

  const url = new URL(endpoint())
  url.searchParams.set('list-type', '2')
  url.searchParams.set('prefix', prefix)
  url.searchParams.set('max-keys', String(limit))
  if (continuationToken) {
    url.searchParams.set('continuation-token', continuationToken)
  }

  const response = await client().fetch(url.toString())
  if (!response.ok) {
    throw new Error(`S3 LIST ${prefix} failed: ${response.status} ${await safeText(response)}`)
  }

  const xml = await response.text()
  const objects: StorageObjectInfo[] = []
  for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const content = block[1]
    const key = xmlTag(content, 'Key')
    if (!key) {
      continue
    }
    objects.push({
      key: xmlUnescape(key),
      size: Number(xmlTag(content, 'Size') ?? 0),
      etag: normalizeEtag(xmlTag(content, 'ETag')),
      uploaded: parseDate(xmlTag(content, 'LastModified')),
    })
  }

  return {
    objects,
    nextToken:
      xmlTag(xml, 'IsTruncated') === 'true'
        ? xmlUnescape(xmlTag(xml, 'NextContinuationToken') ?? '') || undefined
        : undefined,
  }
}

export async function storageList(prefix: string, limit = LIST_PAGE_SIZE): Promise<StorageObjectInfo[]> {
  const objects: StorageObjectInfo[] = []
  let continuationToken: string | undefined

  do {
    const page = await storageListPage(prefix, limit, continuationToken)
    objects.push(...page.objects)
    continuationToken = page.nextToken
  } while (continuationToken)

  return objects
}

function xmlTag(xml: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1]
}

function xmlUnescape(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function normalizeEtag(value: string | null | undefined): string | undefined {
  return value?.replaceAll('"', '') || undefined
}

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) {
    return undefined
  }
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp)
}

async function safeText(response: Response): Promise<string> {
  return await response.text().catch(() => '')
}
