import { Button } from '@afilmory/ui'
import { clsxm } from '@afilmory/utils'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthUserValue } from '~/atoms/auth'
import { LinearBorderPanel } from '~/components/common/LinearBorderPanel'
import { useDashboardUsersQuery, useUpdateDashboardUserRoleMutation } from '~/modules/auth/hooks/useDashboardUsers'
import type { BetterAuthUserRole } from '~/modules/auth/types'

const ROLE_LABEL_KEYS: Record<BetterAuthUserRole, I18nKeys> = {
  user: 'settings.users.role.user',
  admin: 'settings.users.role.admin',
  superadmin: 'settings.users.role.superadmin',
}

const ROLE_BADGE_CLASS: Record<BetterAuthUserRole, string> = {
  user: 'bg-fill/30 text-text-secondary',
  admin: 'bg-emerald-500/15 text-emerald-300',
  superadmin: 'bg-accent/15 text-accent',
}

function UserAvatar({ name, image }: { name: string | null; image: string | null }) {
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase()
  return (
    <div className="bg-fill/40 text-text-secondary flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-medium">
      {image ? <img src={image} alt="" className="size-full object-cover" /> : initial}
    </div>
  )
}

export function UserManagement() {
  const { t } = useTranslation()
  const currentUser = useAuthUserValue()
  const { data: users, isLoading, isError, error } = useDashboardUsersQuery()
  const updateRole = useUpdateDashboardUserRoleMutation()
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)

  const sortedUsers = useMemo(() => {
    if (!users) {
      return []
    }

    const order: Record<BetterAuthUserRole, number> = { superadmin: 0, admin: 1, user: 2 }
    return users.toSorted((a, b) => order[a.role] - order[b.role] || a.name?.localeCompare(b.name ?? '') || 0)
  }, [users])

  const handleToggleRole = (id: string, role: 'user' | 'admin') => {
    setPendingUserId(id)
    updateRole.mutate(
      { id, role },
      {
        onSettled: () => setPendingUserId(null),
      },
    )
  }

  if (isLoading) {
    return (
      <LinearBorderPanel className="p-6">
        <div className="space-y-4">
          {['skeleton-1', 'skeleton-2', 'skeleton-3'].map((key) => (
            <div key={key} className="flex items-center gap-3">
              <div className="bg-fill/40 size-9 animate-pulse rounded-full" />
              <div className="space-y-2">
                <div className="bg-fill/40 h-4 w-40 animate-pulse rounded" />
                <div className="bg-fill/30 h-3 w-56 animate-pulse rounded" />
              </div>
            </div>
          ))}
        </div>
      </LinearBorderPanel>
    )
  }

  if (isError) {
    return (
      <LinearBorderPanel className="p-6">
        <p className="text-red text-sm">{error.message}</p>
      </LinearBorderPanel>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-text-tertiary text-sm">{t('settings.users.hint')}</p>

      <LinearBorderPanel className="overflow-hidden">
        <div className="divide-fill-tertiary/40 divide-y">
          {sortedUsers.map((user) => {
            const isOwner = user.role === 'superadmin'
            const isSelf = user.id === currentUser?.id
            const pending = pendingUserId === user.id

            return (
              <div key={user.id} className="flex items-center gap-3 px-4 py-3">
                <UserAvatar name={user.name} image={user.image} />

                <div className="min-w-0 flex-1">
                  <p className="text-text truncate text-sm font-medium">
                    {user.name || user.email}
                    {isSelf && <span className="text-text-tertiary ml-1.5 text-xs">{t('settings.users.you')}</span>}
                  </p>
                  <p className="text-text-tertiary truncate text-xs">{user.email}</p>
                </div>

                <span
                  className={clsxm(
                    'shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                    ROLE_BADGE_CLASS[user.role],
                  )}
                >
                  {t(ROLE_LABEL_KEYS[user.role])}
                </span>

                {!isOwner && !isSelf && (
                  <Button
                    type="button"
                    size="sm"
                    variant={user.role === 'admin' ? 'ghost' : 'primary'}
                    isLoading={pending}
                    disabled={pending}
                    onClick={() => handleToggleRole(user.id, user.role === 'admin' ? 'user' : 'admin')}
                  >
                    {user.role === 'admin' ? t('settings.users.demote') : t('settings.users.promote')}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </LinearBorderPanel>
    </div>
  )
}
