import { useTranslation } from 'react-i18next'

import { MainPageLayout } from '~/components/layouts/MainPageLayout'

import { PhotoLibraryProvider } from './library/photo-library'
import { PhotoLibraryActionBar } from './library/PhotoLibraryActionBar'
import { PhotoLibraryDropUpload } from './library/PhotoLibraryDropUpload'
import { PhotoLibraryGrid } from './library/PhotoLibraryGrid'

export function PhotoPage() {
  const { t } = useTranslation()
  return (
    <PhotoLibraryProvider isActive>
      <MainPageLayout title={t('photos.page.title')} description={t('photos.page.description')}>
        <MainPageLayout.Actions>
          <PhotoLibraryActionBar />
        </MainPageLayout.Actions>

        <div className="space-y-4 sm:space-y-6">
          <PhotoLibraryDropUpload />
          <PhotoLibraryGrid />
        </div>
      </MainPageLayout>
    </PhotoLibraryProvider>
  )
}
