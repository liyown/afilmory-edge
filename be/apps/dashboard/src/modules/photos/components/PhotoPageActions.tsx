import { MainPageLayout } from '~/components/layouts/MainPageLayout'

import { PhotoLibraryActionBar } from './library/PhotoLibraryActionBar'
import type { PhotoPageTab } from './PhotoPageTabs'

type PhotoPageActionsProps = {
  activeTab: PhotoPageTab
}

export function PhotoPageActions({ activeTab }: PhotoPageActionsProps) {
  if (activeTab !== 'library') {
    return null
  }

  return (
    <MainPageLayout.Actions>
      <PhotoLibraryActionBar />
    </MainPageLayout.Actions>
  )
}
