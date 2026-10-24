import { Button } from '@afilmory/ui'
import { useShallow } from 'zustand/shallow'

import { usePhotoUploadStore } from '../store'
import { UploadFileList } from '../UploadFileList'

export function UploadingStep() {
  const { uploadEntries, progress, finalizeProgress } = usePhotoUploadStore(
    useShallow((state) => ({
      uploadEntries: state.uploadEntries,
      progress: state.totalSize === 0 ? 0 : Math.min(1, state.uploadedBytes / state.totalSize),
      finalizeProgress: state.finalizeProgress,
    })),
  )
  const abortCurrent = usePhotoUploadStore((state) => state.abortCurrent)
  const finalizing = progress >= 1 && finalizeProgress !== null
  const publishing = finalizeProgress?.publishing ?? false
  const finalizeRatio =
    finalizeProgress && finalizeProgress.total > 0
      ? Math.min(1, finalizeProgress.completed / finalizeProgress.total)
      : 0

  const heading = publishing ? '正在更新图库' : finalizing ? '正在完成入库' : '正在上传文件'
  const description = publishing
    ? '正在写入图库清单，马上就好。'
    : finalizing
      ? '文件已全部上传，正在写入数据库。'
      : '正在处理选中的文件，请保持页面打开，以免中断进度。'

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-text text-lg font-semibold">{heading}</h2>
        <p className="text-text-tertiary text-sm">{description}</p>
      </div>

      {finalizing ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">{publishing ? '正在更新图库' : '正在完成入库'}</span>
            <span className="text-text font-mono tabular-nums">
              {publishing ? '100%' : `${finalizeProgress.completed} / ${finalizeProgress.total}`}
            </span>
          </div>
          <div
            className="bg-fill/20 h-1.5 rounded-full"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((publishing ? 1 : finalizeRatio) * 100)}
            aria-label="完成入库进度"
          >
            <div
              className="bg-sky-400 h-full rounded-full transition-[width] duration-300"
              style={{ width: `${(publishing ? 1 : finalizeRatio) * 100}%` }}
            />
          </div>
          {finalizeProgress.failed > 0 ? (
            <p className="text-rose-300 text-[11px]">{finalizeProgress.failed} 个文件入库失败</p>
          ) : null}
        </div>
      ) : null}

      <UploadFileList entries={uploadEntries} overallProgress={progress} />

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={abortCurrent}
          className="text-rose-300 hover:text-rose-200"
        >
          停止上传
        </Button>
        <Button type="button" variant="primary" size="sm" disabled isLoading>
          {publishing ? '更新图库...' : finalizing ? '处理中...' : '上传中...'}
        </Button>
      </div>
    </div>
  )
}
