import { useMemo } from 'react'

import { useUserRole } from '~/atoms/auth'
import { PageTabs } from '~/components/navigation/PageTabs'

const SETTINGS_TABS = [
  {
    id: 'site',
    labelKey: 'settings.nav.site',
    path: '/settings/site',
    end: true,
  },
  {
    id: 'user',
    labelKey: 'settings.nav.user',
    path: '/settings/user',
    end: true,
  },
  {
    id: 'users',
    labelKey: 'settings.nav.users',
    path: '/settings/users',
    end: true,
    superadminOnly: true,
  },
  {
    id: 'account',
    labelKey: 'settings.nav.account',
    path: '/settings/account',
    end: true,
  },
] as const

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id']

type SettingsNavigationProps = {
  active: SettingsTabId
}

export function SettingsNavigation({ active }: SettingsNavigationProps) {
  const role = useUserRole()

  const tabs = useMemo(
    () => SETTINGS_TABS.filter((tab) => !('superadminOnly' in tab && tab.superadminOnly) || role === 'superadmin'),
    [role],
  )

  return (
    <PageTabs
      activeId={active}
      items={tabs.map((tab) => ({
        id: tab.id,
        labelKey: tab.labelKey,
        to: tab.path,
        end: tab.end,
      }))}
    />
  )
}
