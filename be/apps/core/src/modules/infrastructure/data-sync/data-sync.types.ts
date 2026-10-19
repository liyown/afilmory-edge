import type { PhotoManifestItem } from '@afilmory/typing'
import type { PhotoChange } from '@core/modules/content/manifest-sync/manifest-sync.types'

export type DataSyncActionType = 'insert' | 'update' | 'delete' | 'conflict' | 'noop' | 'error'

export interface DataSyncAction {
  type: DataSyncActionType
  storageKey: string
  photoId: string | null
  applied: boolean
  resolution?: string
  reason?: string
  conflictId?: string | null
  conflictPayload?: Record<string, unknown> | null
  snapshots?: {
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
  }
  manifestBefore?: PhotoManifestItem | null
  manifestAfter?: PhotoManifestItem | null
  change?: PhotoChange | null
}

export interface DataSyncResultSummary {
  storageObjects: number
  databaseRecords: number
  inserted: number
  updated: number
  deleted: number
  conflicts: number
  skipped: number
  errors: number
}

export interface DataSyncResult {
  summary: DataSyncResultSummary
  actions: DataSyncAction[]
}

export type DataSyncProgressStage = 'missing-in-db' | 'orphan-in-db' | 'metadata-conflicts' | 'status-reconciliation'

export interface DataSyncStageTotals {
  'missing-in-db': number
  'orphan-in-db': number
  'metadata-conflicts': number
  'status-reconciliation': number
}

export interface DataSyncStartEvent {
  type: 'start'
  payload: {
    summary: DataSyncResultSummary
    totals: DataSyncStageTotals
    options: { dryRun: boolean }
  }
}

export interface DataSyncStageEvent {
  type: 'stage'
  payload: {
    stage: DataSyncProgressStage
    status: 'start' | 'complete'
    processed: number
    total: number
    summary: DataSyncResultSummary
  }
}

export interface DataSyncActionEvent {
  type: 'action'
  payload: {
    stage: DataSyncProgressStage
    index: number
    total: number
    action: DataSyncAction
    change?: PhotoChange | null
    summary: DataSyncResultSummary
  }
}

export interface DataSyncCompleteEvent {
  type: 'complete'
  payload: DataSyncResult
}

export interface DataSyncErrorEvent {
  type: 'error'
  payload: {
    message: string
  }
}

export type DataSyncProgressEvent
  = DataSyncStartEvent | DataSyncStageEvent | DataSyncActionEvent | DataSyncCompleteEvent | DataSyncErrorEvent

export type DataSyncProgressEmitter = (event: DataSyncProgressEvent) => Promise<void> | void
