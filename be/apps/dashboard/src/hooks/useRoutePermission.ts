import { FetchError } from 'ofetch'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'

import { useSetAccessDenied } from '~/atoms/access-denied'
import { PUBLIC_ROUTES, ROUTE_PATHS } from '~/constants/routes'
import { checkDashboardAccess } from '~/modules/auth/api/permissions'
import type { SessionResponse } from '~/modules/auth/api/session'

function requiresDashboardAccess(pathname: string): boolean {
  return Boolean(pathname) && !PUBLIC_ROUTES.has(pathname)
}

type UseRoutePermissionArgs = {
  session: SessionResponse | null
  isLoading: boolean
}

export function useRoutePermission({ session, isLoading }: UseRoutePermissionArgs) {
  const location = useLocation()
  const setAccessDenied = useSetAccessDenied()
  const { t } = useTranslation()

  useEffect(() => {
    if (isLoading) {
      return
    }
    if (!session) {
      return
    }

    const pathname = location.pathname || '/'
    if (pathname === ROUTE_PATHS.NO_ACCESS) {
      return
    }

    if (!requiresDashboardAccess(pathname)) {
      setAccessDenied(prev => (prev?.source === 'api' ? prev : null))
      return
    }

    let active = true

    checkDashboardAccess()
      .then(() => {
        if (!active) {
          return
        }
        setAccessDenied((prev) => {
          if (prev?.source === 'api') {
            return prev
          }
          return null
        })
      })
      .catch((error) => {
        if (!active) {
          return
        }
        if (error instanceof FetchError && error.statusCode === 403) {
          const reason
            = (error.data as { message?: string } | undefined)?.message
              ?? error.response?._data?.message
              ?? t('access-denied.default-reason')
          setAccessDenied({
            active: true,
            status: 403,
            path: pathname,
            scope: 'admin',
            reason,
            source: 'route',
            timestamp: Date.now(),
          })
          return
        }
        console.error('Failed to verify route permission', error)
      })

    return () => {
      active = false
    }
  }, [isLoading, location.pathname, session, setAccessDenied])
}
