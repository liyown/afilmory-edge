import { clsxm, Spring } from '@afilmory/utils'
import { useAtom } from 'jotai'
import { m } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { gallerySettingAtom } from '~/atoms/app'
import { useMobile } from '~/hooks/useMobile'
import { useSemanticSearch } from '~/hooks/useSemanticSearch'

export const PageHeaderSearch = () => {
  const { t } = useTranslation()
  const isMobile = useMobile()
  const [settings, setSettings] = useAtom(gallerySettingAtom)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expandedWidth, setExpandedWidth] = useState(320)
  const mobileInputRef = useRef<HTMLInputElement>(null)
  const search = useSemanticSearch(settings.searchQuery)

  const update = (value: string) => {
    setSettings((prev) => ({ ...prev, searchQuery: value }))
  }

  useEffect(() => {
    const syncWidth = () => setExpandedWidth(Math.min(window.innerWidth - 24, 420))
    syncWidth()
    window.addEventListener('resize', syncWidth)
    return () => window.removeEventListener('resize', syncWidth)
  }, [])

  useEffect(() => {
    if (!mobileOpen) {
      return
    }
    const timer = setTimeout(() => mobileInputRef.current?.focus(), 180)
    return () => clearTimeout(timer)
  }, [mobileOpen])

  if (isMobile) {
    return (
      <m.div
        initial={false}
        animate={{
          width: mobileOpen ? expandedWidth : 44,
          height: mobileOpen ? 52 : 44,
          borderRadius: mobileOpen ? 26 : 22,
        }}
        transition={Spring.presets.smooth}
        className="bg-material-thick/85 fixed right-[max(0.75rem,env(safe-area-inset-right))] bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 flex items-center overflow-hidden border border-white/15 shadow-2xl backdrop-blur-2xl"
      >
        <button
          type="button"
          aria-label={t('search.placeholderShort')}
          aria-expanded={mobileOpen}
          onClick={() => {
            if (mobileOpen) {
              mobileInputRef.current?.focus()
            } else {
              setMobileOpen(true)
            }
          }}
          className="relative flex size-11 shrink-0 items-center justify-center text-white/70 transition-colors hover:text-white"
        >
          <i className="i-mingcute-search-line text-lg" aria-hidden="true" />
          {!mobileOpen && settings.searchQuery.trim() && (
            <span className="bg-accent absolute top-2 right-2 size-1.5 rounded-full" aria-hidden="true" />
          )}
        </button>

        <input
          ref={mobileInputRef}
          id="gallery-search-mobile"
          value={settings.searchQuery}
          onChange={(event) => update(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setMobileOpen(false)
              event.currentTarget.blur()
            }
          }}
          placeholder={t('search.placeholderShort')}
          aria-label={t('search.placeholder')}
          tabIndex={mobileOpen ? 0 : -1}
          className={clsxm(
            'h-full min-w-0 flex-1 bg-transparent text-base text-white outline-none transition-opacity duration-200 placeholder:text-white/35',
            mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          autoComplete="off"
          spellCheck={false}
        />

        {mobileOpen && settings.searchQuery.length > 0 && (
          <button
            type="button"
            onClick={() => {
              update('')
              mobileInputRef.current?.focus()
            }}
            aria-label={t('search.clear')}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          >
            <i className="i-mingcute-close-line text-base" aria-hidden="true" />
          </button>
        )}

        {mobileOpen && (
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false)
              mobileInputRef.current?.blur()
            }}
            aria-label={t('action.close')}
            className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          >
            <i className="i-mingcute-down-line text-lg" aria-hidden="true" />
          </button>
        )}
      </m.div>
    )
  }

  return (
    <div className="relative min-w-0 flex-1 lg:max-w-md">
      <div className="bg-material-thick/60 flex h-9 items-center gap-2 rounded-full border border-white/10 px-3 backdrop-blur-xl">
        <i className="i-mingcute-search-line shrink-0 text-sm text-white/50" aria-hidden="true" />
        <input
          id="gallery-search"
          value={settings.searchQuery}
          onChange={(event) => update(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              update('')
              event.currentTarget.blur()
            }
          }}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
          autoComplete="off"
          spellCheck={false}
        />
        {search.isPending && (
          <i className="i-mingcute-loading-3-line size-4 shrink-0 animate-spin text-white/50" aria-hidden="true" />
        )}
        {settings.searchQuery.length > 0 && !search.isPending && (
          <button
            type="button"
            onClick={() => update('')}
            aria-label={t('search.clear')}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          >
            <i className="i-mingcute-close-line text-sm" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
