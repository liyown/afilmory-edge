// S3-compatible object storage (Aliyun OSS). Photo bytes, the rendered
// manifest, OG cards, and D1 backups all live in one private bucket; media is
// served to visitors through the Worker's `/media/*` proxy.

import { env } from '@afilmory/env'
import { AwsClient } from 'aws4fetch'

const LIST_PAGE_SIZE = 1000
const DELETE_CONCURRENCY = 8
const PUBLIC_MEDIA_PREFIX = '/media'

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

export function isStorageConfigured(): boolean {
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

export async function presignStorageUrl(method: string, key: string, query?: Record<string, string>): Promise<string> {
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
  const url = objectUrl(key)
  for (const [name, value] of Object.entries(query ?? {})) {
    url.searchParams.set(name, value)
  }
  return await client().fetch(url.toString(), init)
}

export async function storageHead(key: string): Promise<StorageObjectInfo | null> {
  const response = await client().fetch(objectUrl(key).toString(), { method: 'HEAD' })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(`S3 HEAD ${key} failed: ${response.status} ${await safeText(response)}`)
  }

  return {
    key,
    size: Number(response.headers.get('content-length') ?? 0),
    etag: normalizeEtag(response.headers.get('etag')),
    uploaded: parseDate(response.headers.get('last-modified')),
  }
}

export async function storageGet(
  key: string,
  range?: { offset: number; length: number },
): Promise<StorageObject | null> {
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

export async function storageDelete(keys: string[]): Promise<void> {
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
