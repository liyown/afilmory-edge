import { useParams } from 'react-router'

import type { PhotoPageTab } from './PhotoPageTabs'
import { PHOTO_TABS } from './PhotoPageTabs'
import { PhotoLibraryTab } from './tabs/PhotoLibraryTab'
import { PhotoStorageTab } from './tabs/PhotoStorageTab'

const DEFAULT_TAB: PhotoPageTab = 'library'

function isPhotoPageTab(value?: string): value is PhotoPageTab {
  return Boolean(value && PHOTO_TABS.includes(value as PhotoPageTab))
}

export function PhotoPage() {
  const { tab } = useParams<{ tab?: string }>()
  const activeTab = isPhotoPageTab(tab) ? (tab as PhotoPageTab) : DEFAULT_TAB

  switch (activeTab) {
    case 'storage': {
      return <PhotoStorageTab />
    }
    case 'library': {
      return <PhotoLibraryTab />
    }
  }
  return <PhotoLibraryTab />
}
