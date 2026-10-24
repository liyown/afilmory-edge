import { Button } from '@afilmory/ui'
import { useShallow } from 'zustand/shallow'

import { usePhotoUploadStore } from '../store'
import { UploadFileList } from '../UploadFileList'

export function UploadingStep() {
  const { uploadEntries, progress } = usePhotoUploadStore(
    useShallow((state) => ({
      uploadEntries: state.uploadEntries,
      progress: state.totalSize === 0 ? 0 : Math.min(1, state.uploadedBytes / state.totalSize),
    })),
  )
  const abortCurrent = usePhotoUploadStore((state) => state.abortCurrent)
  const finalizing = progress >= 1

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-text text-lg font-semibold">{finalizing ? '正在完成入库' : '正在上传文件'}</h2>
        <p className="text-text-tertiary text-sm">
          {finalizing
            ? '文件已全部上传，正在写入数据库并更新图库。'
            : '正在处理选中的文件，请保持页面打开，以免中断进度。'}
        </p>
      </div>

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
          {finalizing ? '处理中...' : '上传中...'}
        </Button>
      </div>
    </div>
  )
}
