import type { PhotoUploadFinalizeEvent, PhotoUploadProgressSnapshot } from '../../api'
import type { PhotoSyncProgressEvent } from '../../types'

export type PhotoUploadRequestOptions = {
  concurrency?: number
  signal?: AbortSignal
  onUploadProgress?: (snapshot: PhotoUploadProgressSnapshot) => void
  onFinalizeProgress?: (event: PhotoUploadFinalizeEvent) => void
  directory?: string | null
  timeoutMs?: number
  onServerEvent?: (event: PhotoSyncProgressEvent) => void
}
