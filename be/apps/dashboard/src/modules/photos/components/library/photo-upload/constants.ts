import type { PhotoSyncProgressStage, PhotoSyncResultSummary } from '../../../types'
import type { WorkflowPhase } from './types'

export const MIN_UPLOAD_CONCURRENCY = 1
export const MAX_UPLOAD_CONCURRENCY = 10
export const DEFAULT_UPLOAD_CONCURRENCY = 3

export const WORKFLOW_STEP_LABEL: Record<Exclude<WorkflowPhase, 'error'>, string> = {
  review: '校验文件',
  uploading: '上传中',
  processing: '服务器处理',
  completed: '完成',
}

export const DISPLAY_STEPS: Array<Exclude<WorkflowPhase, 'error'>> = ['review', 'uploading', 'processing', 'completed']

export const STAGE_CONFIG: Record<
  PhotoSyncProgressStage,
  {
    label: string
    description: string
  }
> = {
  'missing-in-db': {
    label: '导入新照片',
    description: '将新文件写入数据库记录',
  },
  'orphan-in-db': {
    label: '校验孤立记录',
    description: '确认缺失文件的旧记录状态',
  },
  'metadata-conflicts': {
    label: '比对元数据',
    description: '检查文件与数据库间的元数据差异',
  },
  'status-reconciliation': {
    label: '状态对齐',
    description: '写入最新缩略图与状态',
  },
}

export const STAGE_ORDER: PhotoSyncProgressStage[] = [
  'missing-in-db',
  'orphan-in-db',
  'metadata-conflicts',
  'status-reconciliation',
]

export const SUMMARY_FIELDS: Array<{ key: keyof PhotoSyncResultSummary; label: string }> = [
  { key: 'inserted', label: '新增' },
  { key: 'updated', label: '更新' },
  { key: 'conflicts', label: '冲突' },
  { key: 'errors', label: '错误' },
]

export const FILE_STATUS_LABEL = {
  pending: '待上传',
  uploading: '上传中',
  uploaded: '已上传',
  processing: '处理中',
  done: '完成',
  error: '失败',
} as const

export const FILE_STATUS_CLASS = {
  pending: 'text-text-tertiary',
  uploading: 'text-accent',
  uploaded: 'text-sky-300',
  processing: 'text-amber-300',
  done: 'text-emerald-300',
  error: 'text-rose-300',
} as const
