import { clsxm } from '@afilmory/utils'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'

import { useAuthUserValue } from '~/atoms/auth'
import { dashboardSiteName } from '~/config/site'

import { LanguageSwitcher } from './LanguageSwitcher'
import { UserMenu } from './UserMenu'

const navigationTabs = [
  { labelKey: 'nav.overview', path: '/' },
  { labelKey: 'nav.photos', path: '/photos' },
  { labelKey: 'nav.comments', path: '/comments' },
  { labelKey: 'nav.analytics', path: '/analytics' },
  { labelKey: 'nav.settings', path: '/settings' },
] as const satisfies readonly { labelKey: I18nKeys; path: string }[]

export function Header() {
  const user = useAuthUserValue()
  const { t } = useTranslation()

  return (
    <header className="bg-background relative shrink-0 border-b border-fill-tertiary/50">
      <div className="flex h-14 items-center px-3 sm:px-6">
        {/* Logo/Brand */}
        <a href="/" className="text-text mr-2 sm:mr-8 text-sm sm:text-base font-semibold tracking-tight">
          {dashboardSiteName}
        </a>

        {/* Navigation Tabs */}
        <nav className="flex flex-1 items-center gap-0.5 sm:gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {navigationTabs.map((tab) => (
            <NavLink key={tab.path} to={tab.path} end={tab.path === '/'}>
              {({ isActive }) => (
                <div
                  className={clsxm(
                    'relative rounded-lg px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap',
                    'hover:bg-fill/30',
                    isActive ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:text-text',
                  )}
                >
                  {t(tab.labelKey)}
                </div>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Right side - User Menu */}
        <div className="ml-2 flex items-center gap-2 sm:ml-auto sm:gap-3 sm:border-l sm:border-fill-tertiary/50 sm:pl-4">
          <LanguageSwitcher />
          {user && <UserMenu user={user} />}
        </div>
      </div>
    </header>
  )
}
