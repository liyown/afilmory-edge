import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'

import { gallerySettingAtom } from '~/atoms/app'
import { useSemanticSearch } from '~/hooks/useSemanticSearch'

export const PageHeaderSearch = () => {
  const { t } = useTranslation()
  const [settings, setSettings] = useAtom(gallerySettingAtom)
  const search = useSemanticSearch(settings.searchQuery)

  const update = (value: string) => {
    setSettings((prev) => ({ ...prev, searchQuery: value }))
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
