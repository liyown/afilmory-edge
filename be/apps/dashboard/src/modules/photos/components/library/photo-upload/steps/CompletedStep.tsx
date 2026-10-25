import { Button } from '@afilmory/ui'
import { useShallow } from 'zustand/shallow'

import { usePhotoUploadStore } from '../store'
import { UploadFileList } from '../UploadFileList'
import { STEP_ACTION_BUTTON_CLASS, STEP_ACTIONS_CLASS } from './actions'

export function CompletedStep() {
  const { uploadEntries, progress } = usePhotoUploadStore(
    useShallow((state) => ({
      uploadEntries: state.uploadEntries,
      progress: state.totalSize === 0 ? 0 : Math.min(1, state.uploadedBytes / state.totalSize),
    })),
  )
  const closeModal = usePhotoUploadStore((state) => state.closeModal)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-text text-lg font-semibold">上传完成</h2>
        <p className="text-text-tertiary text-sm">所有文件均已上传并处理完成，新的照片已加入图库。</p>
      </div>

      <UploadFileList entries={uploadEntries} overallProgress={progress} />

      <div className={STEP_ACTIONS_CLASS}>
        <Button type="button" variant="primary" size="sm" onClick={closeModal} className={STEP_ACTION_BUTTON_CLASS}>
          完成
        </Button>
      </div>
    </div>
  )
}
