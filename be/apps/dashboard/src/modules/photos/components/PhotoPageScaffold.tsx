import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { MainPageLayout } from '~/components/layouts/MainPageLayout'
import { PageTabs } from '~/components/navigation/PageTabs'

import { PhotoPageActions } from './PhotoPageActions'
import type { PhotoPageTab } from './PhotoPageTabs'
import { TAB_ROUTE_MAP } from './PhotoPageTabs'

type PhotoPageScaffoldProps = {
  activeTab: PhotoPageTab
  children: ReactNode
}

export function PhotoPageScaffold({ activeTab, children }: PhotoPageScaffoldProps) {
  const { t } = useTranslation()
  return (
    <MainPageLayout title={t('photos.page.title')} description={t('photos.page.description')}>
      <PhotoPageActions activeTab={activeTab} />

      <div className="space-y-4 sm:space-y-6">
        <PageTabs
          activeId={activeTab}
          items={[
            { id: 'library', labelKey: 'photos.tabs.library', to: TAB_ROUTE_MAP.library, end: true },
            { id: 'storage', labelKey: 'photos.tabs.storage', to: TAB_ROUTE_MAP.storage, end: true },
          ]}
        />

        {children}
      </div>
    </MainPageLayout>
  )
}
