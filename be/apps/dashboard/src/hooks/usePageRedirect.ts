import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { useSetAuthUser } from '~/atoms/auth'
import { PUBLIC_ROUTES, ROUTE_PATHS } from '~/constants/routes'
import type { SessionResponse } from '~/modules/auth/api/session'
import { AUTH_SESSION_QUERY_KEY, fetchSession } from '~/modules/auth/api/session'
import { signOutBySource } from '~/modules/auth/auth-client'

const AUTH_FAILURE_STATUSES = new Set([401, 403, 419])

export function usePageRedirect() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setAuthUser = useSetAuthUser()

  const sessionQuery = useQuery<SessionResponse | null>({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: async () => {
      try {
        return await fetchSession()
      }
      catch (error) {
        if (error instanceof FetchError) {
          const status = error.statusCode ?? error.response?.status ?? null
          if (status && AUTH_FAILURE_STATUSES.has(status)) {
            return null
          }
        }
        throw error
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const logout = useCallback(async () => {
    try {
      await signOutBySource()
    }
    catch (error) {
      console.error('Logout error:', error)
    }
    finally {
      queryClient.setQueryData(AUTH_SESSION_QUERY_KEY, null)
      queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY })
      setAuthUser(null)
      navigate(ROUTE_PATHS.LOGIN, { replace: true })
    }
  }, [navigate, queryClient, setAuthUser])

  useEffect(() => {
    setAuthUser(sessionQuery.data?.user ?? null)
  }, [sessionQuery.data, setAuthUser])

  useEffect(() => {
    if (sessionQuery.isPending || sessionQuery.isError) {
      return
    }

    const { pathname } = location
    const session = sessionQuery.data

    if (!session && !PUBLIC_ROUTES.has(pathname)) {
      navigate(ROUTE_PATHS.LOGIN, { replace: true })
      return
    }

    if (session && pathname === ROUTE_PATHS.LOGIN) {
      navigate(ROUTE_PATHS.DEFAULT_AUTHENTICATED, { replace: true })
    }
  }, [location, sessionQuery.data, sessionQuery.isError, sessionQuery.isPending, navigate])

  return {
    sessionQuery,

    logout,
    isAuthenticated: !!sessionQuery.data,
    user: sessionQuery.data?.user,
  }
}
