import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getAuthUser, setAuthUser } from '~/atoms/auth'
import { AUTH_SESSION_QUERY_KEY } from '~/modules/auth/api/session'

import { getSiteAuthorProfile, getSiteSettingUiSchema, updateSiteAuthorProfile, updateSiteSettings } from './api'
import type { SiteSettingEntryInput, UpdateSiteAuthorPayload } from './types'

export const SITE_SETTING_UI_SCHEMA_QUERY_KEY = ['site-settings', 'ui-schema'] as const
export const SITE_AUTHOR_PROFILE_QUERY_KEY = ['site-settings', 'author-profile'] as const

export function useSiteSettingUiSchemaQuery() {
  return useQuery({
    queryKey: SITE_SETTING_UI_SCHEMA_QUERY_KEY,
    queryFn: getSiteSettingUiSchema,
  })
}

export function useUpdateSiteSettingsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (entries: readonly SiteSettingEntryInput[]) => {
      await updateSiteSettings(entries)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: SITE_SETTING_UI_SCHEMA_QUERY_KEY,
      })
    },
  })
}

export function useSiteAuthorProfileQuery() {
  return useQuery({
    queryKey: SITE_AUTHOR_PROFILE_QUERY_KEY,
    queryFn: getSiteAuthorProfile,
  })
}

export function useUpdateSiteAuthorProfileMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: UpdateSiteAuthorPayload) => {
      return await updateSiteAuthorProfile(payload)
    },
    onSuccess: (profile) => {
      void queryClient.invalidateQueries({ queryKey: SITE_AUTHOR_PROFILE_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY })

      const current = getAuthUser()
      if (current) {
        setAuthUser({ ...current, name: profile.name, image: profile.avatar ?? null })
      }
    },
  })
}
