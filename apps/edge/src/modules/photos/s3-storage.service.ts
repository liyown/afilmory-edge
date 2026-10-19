import { BizException, ErrorCode } from '@core/errors'
import { injectable } from 'tsyringe'

import type {StorageObjectInfo} from '../../storage';
import {
  isStorageConfigured,
  mediaUrl,
  presignStorageUrl,
  signedStorageFetch,
  storageDelete,
  storageGet,
  storageHead,
  storagePut
} from '../../storage'

const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024
const MIN_PART_SIZE_BYTES = 8 * 1024 * 1024

export interface UploadIntentResult {
  mode: 'single' | 'multipart'
  key: string
  headers: Record<string, string>
  url?: string
  uploadId?: string
  parts?: Array<{ partNumber: number; url: string }>
  expiresAt?: string
}

export interface MultipartPart {
  partNumber: number
  etag: string
}

function storageUnavailable(): BizException {
  return new BizException(ErrorCode.COMMON_INTERNAL_SERVER_ERROR, {
    message: 'S3 storage is not configured',
  })
}

@injectable()
export class S3StorageService {
  isDirectUploadConfigured(): boolean {
    return isStorageConfigured()
  }

  async createUploadIntent(input: {
    key: string
    size: number
    contentType?: string | null
  }): Promise<UploadIntentResult> {
    if (!isStorageConfigured()) {
      throw storageUnavailable()
    }

    const headers: Record<string, string> = {}
    if (input.contentType) {
      headers['content-type'] = input.contentType
    }

    if (input.size > MULTIPART_THRESHOLD_BYTES) {
      return await this.createMultipartIntent(input.key, input.size, headers)
    }

    return {
      mode: 'single',
      key: input.key,
      headers,
      url: await presignStorageUrl('PUT', input.key),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }
  }

  private async createMultipartIntent(
    key: string,
    size: number,
    headers: Record<string, string>,
  ): Promise<UploadIntentResult> {
    let response: Response
    try {
      response = await signedStorageFetch(key, { method: 'POST' }, { uploads: '' })
    } catch (error) {
      throw new BizException(ErrorCode.COMMON_INTERNAL_SERVER_ERROR, {
        message: `Unable to reach the S3 endpoint: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new BizException(ErrorCode.COMMON_INTERNAL_SERVER_ERROR, {
        message: `Failed to create S3 multipart upload: ${response.status}${detail ? ` ${detail}` : ''}`,
      })
    }

    const xml = await response.text()
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1]
    if (!uploadId) {
      throw new BizException(ErrorCode.COMMON_INTERNAL_SERVER_ERROR, {
        message: 'S3 multipart upload response did not include an upload id',
      })
    }

    const partSize = Math.max(MIN_PART_SIZE_BYTES, Math.ceil(size / 10_000 / MIN_PART_SIZE_BYTES) * MIN_PART_SIZE_BYTES)
    const partCount = Math.max(1, Math.ceil(size / partSize))
    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_, index) => {
        const partNumber = index + 1
        const url = await presignStorageUrl('PUT', key, { partNumber: String(partNumber), uploadId })
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
    const body = [
      '<CompleteMultipartUpload>',
      ...parts
        .slice()
        .sort((left, right) => left.partNumber - right.partNumber)
        .map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`),
      '</CompleteMultipartUpload>',
    ].join('')

    const response = await signedStorageFetch(
      key,
      {
        method: 'POST',
        headers: { 'content-type': 'application/xml' },
        body,
      },
      { uploadId },
    )
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Failed to complete S3 multipart upload: ${response.status}${detail ? ` ${detail}` : ''}`)
    }
  }

  async head(key: string): Promise<StorageObjectInfo | null> {
    return await storageHead(key)
  }

  async put(key: string, body: ArrayBuffer | Uint8Array, contentType?: string | null): Promise<void> {
    await storagePut(key, body, { contentType })
  }

  async readRange(key: string, offset: number, length: number): Promise<Uint8Array | null> {
    const object = await storageGet(key, { offset, length })
    return object ? new Uint8Array(await object.response.arrayBuffer()) : null
  }

  async delete(keys: string[]): Promise<void> {
    await storageDelete(keys)
  }

  publicUrl(key: string): string {
    return mediaUrl(key)
  }

  thumbnailUrl(key: string): string {
    return mediaUrl(key)
  }
}
