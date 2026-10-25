import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'

import { useAuthUserValue } from '~/atoms/auth'
import { MainPageLayout } from '~/components/layouts/MainPageLayout'
import { SettingsNavigation } from '~/modules/settings'
import { UserManagement } from '~/modules/settings/components/UserManagement'

export function Component() {
  const { t } = useTranslation()
  const user = useAuthUserValue()

  // The session hydrates after the first paint; wait for it instead of
  // bouncing owners away before their role is known.
  if (!user) {
    return null
  }

  if (user.role !== 'superadmin') {
    return <Navigate to="/settings/site" replace />
  }

  return (
    <MainPageLayout title={t('settings.users.title')} description={t('settings.users.description')}>
      <div className="space-y-6">
        <SettingsNavigation active="users" />
        <UserManagement />
      </div>
    </MainPageLayout>
  )
}
