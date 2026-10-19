import { env } from '@afilmory/env'
import { BizException, ErrorCode } from '@core/errors'
import { AwsClient } from 'aws4fetch'
import { env as workerEnv } from 'cloudflare:workers'
import { injectable } from 'tsyringe'

const DEFAULT_BUCKET = 'afilmory-photos'
const DEFAULT_PUBLIC_BASE_URL = '/media'
const DISABLED_VALUE = 'disabled'
const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024
const MIN_PART_SIZE_BYTES = 8 * 1024 * 1024

function configured(value: string | undefined): string | undefined {
  return value && value !== DISABLED_VALUE ? value : undefined
}

export interface UploadIntentResult {
  mode: 'single' | 'multipart' | 'proxy'
  key: string
  headers: Record<string, string>
  url?: string
  uploadId?: string
  parts?: Array<{ partNumber: number, url: string }>
  expiresAt?: string
}

export interface MultipartPart {
  partNumber: number
  etag: string
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

function withExpiry(url: URL): URL {
  url.searchParams.set('X-Amz-Expires', '3600')
  return url
}

@injectable()
export class R2UploadService {
  private client(): AwsClient | null {
    const accountId = configured(env.R2_ACCOUNT_ID)
    const accessKeyId = configured(env.R2_ACCESS_KEY_ID)
    const secretAccessKey = configured(env.R2_SECRET_ACCESS_KEY)
    if (!accountId || !accessKeyId || !secretAccessKey) {
      return null
    }

    return new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: 's3',
      region: 'auto',
    })
  }

  get bucketName(): string {
    return configured(env.R2_BUCKET_NAME) ?? DEFAULT_BUCKET
  }

  isDirectUploadConfigured(): boolean {
    return this.client() !== null
  }

  private objectUrl(key: string): URL {
    const accountId = configured(env.R2_ACCOUNT_ID)
    if (!accountId) {
      throw new Error('R2_ACCOUNT_ID is not configured')
    }
    return new URL(`https://${accountId}.r2.cloudflarestorage.com/${this.bucketName}/${encodeKeyPath(key)}`)
  }

  private async presign(method: string, key: string, query?: Record<string, string>): Promise<string> {
    const client = this.client()
    if (!client) {
      throw new Error('R2 S3 credentials are not configured')
    }

    const url = withExpiry(this.objectUrl(key))
    for (const [name, value] of Object.entries(query ?? {})) {
      url.searchParams.set(name, value)
    }

    const signed = await client.sign(url.toString(), {
      method,
      aws: { signQuery: true },
    })
    return signed.url
  }

  async createUploadIntent(input: {
    key: string
    size: number
    contentType?: string | null
  }): Promise<UploadIntentResult> {
    const headers: Record<string, string> = {}
    if (input.contentType) {
      headers['content-type'] = input.contentType
    }

    if (!this.isDirectUploadConfigured()) {
      // Local/offline fallback: stream through the Worker. This keeps uploads
      // working without R2 S3 credentials, bounded by the Worker body limit.
      return {
        mode: 'proxy',
        key: input.key,
        headers,
        url: `/api/photos/upload-content?key=${encodeURIComponent(input.key)}`,
      }
    }

    if (input.size > MULTIPART_THRESHOLD_BYTES) {
      return await this.createMultipartIntent(input.key, input.size, headers)
    }

    const url = await this.presign('PUT', input.key)
    return {
      mode: 'single',
      key: input.key,
      headers,
      url,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }
  }

  private async createMultipartIntent(
    key: string,
    size: number,
    headers: Record<string, string>,
  ): Promise<UploadIntentResult> {
    const client = this.client()
    if (!client) {
      throw new Error('R2 S3 credentials are not configured')
    }

    const createUrl = this.objectUrl(key)
    createUrl.searchParams.set('uploads', '')
    let response: Response
    try {
      response = await client.fetch(createUrl.toString(), { method: 'POST' })
    }
    catch (error) {
      throw new BizException(ErrorCode.COMMON_INTERNAL_SERVER_ERROR, {
        message: `Unable to reach the R2 S3 endpoint: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new BizException(ErrorCode.COMMON_INTERNAL_SERVER_ERROR, {
        message: `Failed to create R2 multipart upload: ${response.status}${detail ? ` ${detail}` : ''}`,
      })
    }

    const xml = await response.text()
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1]
    if (!uploadId) {
      throw new BizException(ErrorCode.COMMON_INTERNAL_SERVER_ERROR, {
        message: 'R2 multipart upload response did not include an upload id',
      })
    }

    const partSize = Math.max(MIN_PART_SIZE_BYTES, Math.ceil(size / 10_000 / MIN_PART_SIZE_BYTES) * MIN_PART_SIZE_BYTES)
    const partCount = Math.max(1, Math.ceil(size / partSize))
    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_, index) => {
        const partNumber = index + 1
        const url = await this.presign('PUT', key, { partNumber: String(partNumber), uploadId })
        return { partNumber, url }
      }),
    )

    return {
      mode: 'multipart',
      key,
      headers,
      uploadId,
      parts,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: MultipartPart[]): Promise<void> {
    const client = this.client()
    if (!client) {
      throw new Error('R2 S3 credentials are not configured')
    }

    const body = [
      '<CompleteMultipartUpload>',
      ...parts
        .slice()
        .sort((left, right) => left.partNumber - right.partNumber)
        .map(part => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`),
      '</CompleteMultipartUpload>',
    ].join('')

    const url = this.objectUrl(key)
    url.searchParams.set('uploadId', uploadId)
    const response = await client.fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/xml' },
      body,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Failed to complete R2 multipart upload: ${response.status}${detail ? ` ${detail}` : ''}`)
    }
  }

  async head(key: string) {
    return await workerEnv.PHOTOS.head(key)
  }

  async put(key: string, body: ReadableStream | ArrayBuffer, contentType?: string | null): Promise<void> {
    await workerEnv.PHOTOS.put(key, body, {
      httpMetadata: contentType ? { contentType } : undefined,
    })
  }

  async readRange(key: string, offset: number, length: number): Promise<Uint8Array | null> {
    const object = await workerEnv.PHOTOS.get(key, { range: { offset, length } })
    return object ? new Uint8Array(await object.arrayBuffer()) : null
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return
    }
    await workerEnv.PHOTOS.delete(keys)
  }

  publicUrl(key: string): string {
    const base = (configured(env.R2_PUBLIC_BASE_URL) ?? DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, '')
    return `${base}/${encodeKeyPath(key)}`
  }

  // Cloudflare Image Resizing only exists on proxied zones. With the relative
  // `/media` default (workers.dev/local) there is no resizing endpoint, so fall
  // back to the original; an absolute CDN/domain base opts into `/cdn-cgi/image`.
  thumbnailUrl(key: string, width = 1024): string {
    const original = this.publicUrl(key)
    const base = (configured(env.R2_PUBLIC_BASE_URL) ?? DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(base)) {
      return original
    }

    const origin = new URL(base).origin
    const path = original.startsWith(origin) ? original.slice(origin.length) : original
    return `${origin}/cdn-cgi/image/width=${width},format=auto,quality=80${path}`
  }
}
