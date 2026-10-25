import { Button } from '@afilmory/ui'
import { ArrowLeft, ImagePlus } from 'lucide-react'
import type { ChangeEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker, useNavigate } from 'react-router'

import { ROUTE_PATHS } from '~/constants/routes'
import { useUploadPhotoAssetsMutation } from '~/modules/photos/hooks'

import { clearPendingMobileUpload, peekPendingMobileUpload } from './library/mobile-upload-pending'
import { PhotoUploadSteps } from './library/photo-upload/steps'
import { PhotoUploadStoreProvider, usePhotoUploadStore } from './library/photo-upload/store'
import type { WorkflowPhase } from './library/photo-upload/types'
import type { PhotoUploadRequestOptions } from './library/upload.types'
import { PHOTO_UPLOAD_ACCEPT } from './library/upload.types'

const EMPTY_TAGS: string[] = []

function phaseSubtitle(phase: WorkflowPhase, fileCount: number): string {
  switch (phase) {
    case 'review': {
      return `${fileCount} 个文件待上传`
    }
    case 'uploading': {
      return '正在上传，请保持页面打开'
    }
    case 'processing': {
      return '正在写入图库'
    }
    case 'completed': {
      return '上传完成'
    }
    case 'error': {
      return '上传失败'
    }
  }
}

function PageShell({ subtitle, onBack, children }: { subtitle: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="bg-background flex h-svh flex-col overflow-hidden">
      <header className="flex shrink-0 items-center border-b border-white/10 px-2 pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 w-full items-center gap-2">
          <button
            type="button"
            aria-label="返回图库"
            onClick={onBack}
            className="text-text-secondary hover:text-text hover:bg-fill/10 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-text truncate text-sm font-semibold">上传照片</h1>
            <p className="text-text-tertiary truncate text-[11px]">{subtitle}</p>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <div className="mx-auto w-full max-w-xl">{children}</div>
      </main>
    </div>
  )
}

function UploadWorkspace({ fileCount, onClose }: { fileCount: number; onClose: () => void }) {
  const phase = usePhotoUploadStore((state) => state.phase)
  const active = phase === 'uploading' || phase === 'processing'
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => active && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (!active) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [active])

  return (
    <>
      <PageShell subtitle={phaseSubtitle(phase, fileCount)} onBack={onClose}>
        <PhotoUploadSteps />
      </PageShell>

      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="bg-background w-full max-w-sm rounded-2xl border border-white/10 p-5 shadow-2xl">
            <h2 className="text-text text-base font-semibold">中断上传？</h2>
            <p className="text-text-tertiary mt-1 text-sm">上传正在进行，离开会中断当前进度。</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => blocker.reset?.()}>
                继续上传
              </Button>
              <Button variant="primary" size="sm" onClick={() => blocker.proceed?.()}>
                离开
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function PhotoUploadPage() {
  const navigate = useNavigate()
  const pendingRef = useRef(peekPendingMobileUpload())
  const pending = pendingRef.current
  const [files, setFiles] = useState<File[] | null>(pending?.files ?? null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { mutateAsync } = useUploadPhotoAssetsMutation()

  useEffect(() => {
    return () => {
      clearPendingMobileUpload()
    }
  }, [])

  const close = useCallback(() => {
    navigate(ROUTE_PATHS.PHOTOS, { replace: true })
  }, [navigate])

  const handleUpload = useCallback(
    async (fileList: FileList, options?: PhotoUploadRequestOptions) => {
      await mutateAsync({
        files: Array.from(fileList),
        concurrency: options?.concurrency,
        directory: options?.directory ?? undefined,
        signal: options?.signal,
        onProgress: options?.onUploadProgress,
        onFinalizeProgress: options?.onFinalizeProgress,
        timeoutMs: options?.timeoutMs,
        onServerEvent: options?.onServerEvent,
      })
    },
    [mutateAsync],
  )

  const handleFilesPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.currentTarget.files
    if (picked && picked.length > 0) {
      setFiles(Array.from(picked))
    }
    event.currentTarget.value = ''
  }

  if (!files) {
    return (
      <PageShell subtitle="选择照片并上传到图库" onBack={close}>
        <div className="flex min-h-[60svh] flex-col items-center justify-center gap-4 text-center">
          <div className="bg-fill/10 flex size-16 items-center justify-center rounded-2xl ring-1 ring-white/10">
            <ImagePlus className="text-text-secondary size-7" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-text text-base font-semibold">选择要上传的照片</h2>
            <p className="text-text-tertiary mx-auto max-w-xs text-sm">
              支持 JPEG、HEIC、TIFF 以及同名 MOV 组成的 Live Photo。
            </p>
          </div>
          <Button variant="primary" onClick={() => fileInputRef.current?.click()} className="w-full max-w-xs">
            选择照片
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={PHOTO_UPLOAD_ACCEPT}
            className="hidden"
            onChange={handleFilesPicked}
          />
        </div>
      </PageShell>
    )
  }

  return (
    <PhotoUploadStoreProvider
      files={files}
      availableTags={pending?.availableTags ?? EMPTY_TAGS}
      onUpload={handleUpload}
      onClose={close}
    >
      <UploadWorkspace fileCount={files.length} onClose={close} />
    </PhotoUploadStoreProvider>
  )
}
