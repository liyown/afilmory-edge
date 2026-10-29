import { Spring } from '@afilmory/utils'
import type en from '@locales/app/en.json'
import { useAtom } from 'jotai'
import { m as motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import type { GalleryViewMode } from '~/atoms/app'
import { gallerySettingAtom } from '~/atoms/app'

const MODES: Array<{ mode: GalleryViewMode; icon: string; labelKey: keyof typeof en }> = [
  { mode: 'wall', icon: 'i-mingcute-layout-5-line', labelKey: 'gallery.view.wall' },
  { mode: 'masonry', icon: 'i-mingcute-grid-line', labelKey: 'gallery.view.masonry' },
  { mode: 'list', icon: 'i-mingcute-list-ordered-line', labelKey: 'gallery.view.list' },
]

export const ViewModeSegment = () => {
  const { t } = useTranslation()
  const [settings, setSettings] = useAtom(gallerySettingAtom)

  const handleViewModeChange = (mode: GalleryViewMode) => {
    setSettings((prev) => ({ ...prev, viewMode: mode }))
  }

  return (
    <div className="bg-material-medium/40 relative hidden h-7 items-center gap-0.5 rounded-lg p-0.5 sm:flex lg:h-8 lg:gap-1 lg:p-1">
      {MODES.map(({ mode, icon, labelKey }) => {
        const isActive = settings.viewMode === mode
        return (
          <button
            key={mode}
            type="button"
            onClick={() => handleViewModeChange(mode)}
            className={`focus-visible:ring-accent/50 relative z-10 flex h-full items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none lg:px-3 ${
              isActive ? 'text-white' : 'text-white/60 hover:text-white/80'
            }`}
            title={t(labelKey)}
            aria-label={t(labelKey)}
            aria-pressed={isActive}
          >
            {isActive && (
              <motion.span
                layoutId="segment-indicator"
                className="absolute inset-0 rounded-md bg-white/15 shadow-sm"
                transition={Spring.presets.snappy}
              />
            )}
            <i className={`${icon} relative z-10 text-sm lg:text-base`} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
