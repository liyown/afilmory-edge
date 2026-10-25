import { Modal } from '@afilmory/ui'
import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/shallow'

import { ROUTE_PATHS } from '~/constants/routes'
import { useIsMobile } from '~/hooks/useIsMobile'

import { setPendingMobileUpload } from './mobile-upload-pending'
import { usePhotoLibraryStore } from './photo-library'
import { PhotoUploadConfirmModal } from './PhotoUploadConfirmModal'

/**
 * Mobile opens a dedicated full-screen upload page; desktop keeps the existing
 * confirm modal. Both entry points (toolbar and drag/drop) share this launcher.
 */
export function useUploadLauncher() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { availableTags, uploadAssets } = usePhotoLibraryStore(
    useShallow((state) => ({
      availableTags: state.availableTags,
      uploadAssets: state.uploadAssets,
    })),
  )

  return useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        return
      }

      if (isMobile) {
        setPendingMobileUpload({ files, availableTags })
        navigate(ROUTE_PATHS.UPLOAD)
        return
      }

      Modal.present(
        PhotoUploadConfirmModal,
        {
          files,
          availableTags,
          onUpload: uploadAssets,
        },
        {
          dismissOnOutsideClick: false,
        },
      )
    },
    [availableTags, isMobile, navigate, uploadAssets],
  )
}
