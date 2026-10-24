import { useScrollViewElement } from '@afilmory/ui'
import clsx from 'clsx'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { gallerySettingAtom } from '~/atoms/app'
import { useHasActiveFilters } from '~/hooks/useHasActiveFilters'
import { useContextPhotos } from '~/hooks/usePhotoViewer'
import { useSemanticSearch } from '~/hooks/useSemanticSearch'
import { useVisiblePhotosDateRange } from '~/hooks/useVisiblePhotosDateRange'

import type { PanelType } from './ActionPanel'
import { ActionPanel } from './ActionPanel'
import { ActiveFiltersHero } from './ActiveFiltersHero'
import { EditorialIntro, selectEditorialPhotos } from './EditorialIntro'
import { ListView } from './ListView'
import { MasonryView } from './MasonryView'
import { PageFooter } from './PageFooter'
import { PageHeader } from './PageHeader'

export const PhotosRoot = () => {
  const { t } = useTranslation()
  const { viewMode, searchQuery } = useAtomValue(gallerySettingAtom)
  const search = useSemanticSearch(searchQuery)
  const [showFloatingActions, setShowFloatingActions] = useState(false)

  const photos = useContextPhotos()
  const { dateRange, handleRender } = useVisiblePhotosDateRange(photos)
  const scrollElement = useScrollViewElement()

  const [activePanel, setActivePanel] = useState<PanelType | null>(null)

  // 监听滚动，控制浮动组件的显示
  useEffect(() => {
    if (!scrollElement) return

    const handleScroll = () => {
      const { scrollTop } = scrollElement
      setShowFloatingActions(scrollTop > 500)
    }

    scrollElement.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scrollElement.removeEventListener('scroll', handleScroll)
    }
  }, [scrollElement])

  const hasActiveFilters = useHasActiveFilters()

  // The editorial composition only owns the default, unfiltered archive. Any
  // search or filter falls back to the plain masonry so results stay obvious.
  const showEditorial = !hasActiveFilters && !searchQuery.trim() && viewMode === 'masonry' && photos.length > 6
  const { featuredPhotos, masonryPhotos } = useMemo(() => {
    if (!showEditorial) {
      return { featuredPhotos: [] as typeof photos, masonryPhotos: photos }
    }
    const featured = selectEditorialPhotos(photos)
    const featuredIds = new Set(featured.map((photo) => photo.id))
    return { featuredPhotos: featured, masonryPhotos: photos.filter((photo) => !featuredIds.has(photo.id)) }
  }, [photos, showEditorial])

  return (
    <>
      <PageHeader
        dateRange={dateRange.formattedRange}
        location={dateRange.location}
        showDateRange={showFloatingActions && !!dateRange.formattedRange}
      />

      {hasActiveFilters && <ActiveFiltersHero />}

      {searchQuery.trim() && (
        <div className="px-4 pt-14 text-center text-xs text-white/45 lg:pt-14">
          {search.isPending
            ? t('search.loading')
            : photos.length === 0
              ? t('search.empty')
              : search.degraded
                ? t('search.aiUnavailable')
                : t('action.search.results', { count: photos.length })}
        </div>
      )}

      <div className={clsx('pb-20 lg:pb-24', !hasActiveFilters && 'mt-12')}>
        {showEditorial && (
          <div className="px-4 lg:px-8 xl:px-12">
            <EditorialIntro photos={photos} featured={featuredPhotos} />
          </div>
        )}

        {viewMode === 'list' ? (
          <ListView photos={photos} />
        ) : (
          <div className={clsx('px-4 lg:px-8 xl:px-12', showEditorial && 'mt-12 lg:mt-16')}>
            {showEditorial && (
              <div className="mb-5 flex items-baseline justify-between border-t border-white/10 pt-4 font-mono text-[9px] tracking-[0.28em] text-white/35 uppercase">
                <span>The Archive</span>
                <span className="tabular-nums">{masonryPhotos.length}</span>
              </div>
            )}
            <MasonryView photos={masonryPhotos} onRender={handleRender} />
          </div>
        )}
      </div>

      <PageFooter />

      <ActionPanel
        open={!!activePanel}
        onOpenChange={(open) => {
          if (!open) {
            setActivePanel(null)
          }
        }}
        type={activePanel}
      />
    </>
  )
}
