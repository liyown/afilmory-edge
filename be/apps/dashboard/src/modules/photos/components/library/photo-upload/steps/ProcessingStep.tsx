import { Button, ScrollArea } from '@afilmory/ui'
import { useShallow } from 'zustand/shallow'

import { ProcessingPanel } from '../ProcessingPanel'
import { usePhotoUploadStore } from '../store'
import { STEP_ACTION_BUTTON_CLASS, STEP_ACTIONS_CLASS } from './actions'

export function ProcessingStep() {
  const { processingState, processingLogs } = usePhotoUploadStore(
    useShallow((state) => ({
      uploadEntries: state.uploadEntries,
      progress: state.totalSize === 0 ? 0 : Math.min(1, state.uploadedBytes / state.totalSize),
      processingState: state.processingState,
      processingLogs: state.processingLogs,
    })),
  )
  const abortCurrent = usePhotoUploadStore((state) => state.abortCurrent)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-text text-lg font-semibold">服务器处理进行中</h2>
        <p className="text-text-tertiary text-sm">已完成文件上传，正在同步元数据和缩略图，请稍候。</p>
      </div>
      <ScrollArea rootClassName="h-[calc(100vh-23rem)] max-sm:h-[calc(100svh-18rem)] -mx-4" viewportClassName="px-4">
        <ProcessingPanel state={processingState} logs={processingLogs} />
      </ScrollArea>

      <div className={STEP_ACTIONS_CLASS}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={abortCurrent}
          className={`${STEP_ACTION_BUTTON_CLASS} text-rose-300 hover:text-rose-200`}
        >
          停止处理
        </Button>
        <Button type="button" variant="primary" size="sm" disabled isLoading className={STEP_ACTION_BUTTON_CLASS}>
          服务器处理中...
        </Button>
      </div>
    </div>
  )
}
