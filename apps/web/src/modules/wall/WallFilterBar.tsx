import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'

import { gallerySettingAtom } from '~/atoms/app'
import { FilterChips } from '~/modules/gallery/ActiveFiltersHero/FilterChips'

export const WallFilterBar = () => {
  const { t } = useTranslation()
  const [gallerySetting, setGallerySetting] = useAtom(gallerySettingAtom)

  const clearAll = () => {
    setGallerySetting((prev) => ({
      ...prev,
      selectedTags: [],
      selectedCameras: [],
      selectedLenses: [],
      selectedRatings: null,
      selectedDateRange: null,
      tagFilterMode: 'union',
    }))
  }

  if (
    gallerySetting.selectedTags.length === 0 &&
    gallerySetting.selectedCameras.length === 0 &&
    gallerySetting.selectedLenses.length === 0 &&
    gallerySetting.selectedRatings === null &&
    gallerySetting.selectedDateRange === null
  ) {
    return null
  }

  return (
    <div className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-white/10 bg-black/45 py-1.5 pr-2 pl-3 backdrop-blur-2xl">
      <span className="text-text-secondary hidden shrink-0 text-[11px] font-medium tracking-[0.14em] uppercase sm:block">
        {t('gallery.filter.active')}
      </span>
      <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <FilterChips
          tags={gallerySetting.selectedTags}
          cameras={gallerySetting.selectedCameras}
          lenses={gallerySetting.selectedLenses}
          rating={gallerySetting.selectedRatings}
          dateRange={gallerySetting.selectedDateRange}
          onRemoveTag={(tag) =>
            setGallerySetting((prev) => ({ ...prev, selectedTags: prev.selectedTags.filter((item) => item !== tag) }))
          }
          onRemoveCamera={(camera) =>
            setGallerySetting((prev) => ({
              ...prev,
              selectedCameras: prev.selectedCameras.filter((item) => item !== camera),
            }))
          }
          onRemoveLens={(lens) =>
            setGallerySetting((prev) => ({
              ...prev,
              selectedLenses: prev.selectedLenses.filter((item) => item !== lens),
            }))
          }
          onRemoveRating={() => setGallerySetting((prev) => ({ ...prev, selectedRatings: null }))}
          onRemoveDateRange={() => setGallerySetting((prev) => ({ ...prev, selectedDateRange: null }))}
        />
      </div>
      <button
        type="button"
        onClick={clearAll}
        className="text-text-secondary hover:text-text focus-visible:ring-accent/50 shrink-0 rounded-full px-2 py-1 text-xs font-medium transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none"
      >
        {t('gallery.filter.clearAll')}
      </button>
    </div>
  )
}
