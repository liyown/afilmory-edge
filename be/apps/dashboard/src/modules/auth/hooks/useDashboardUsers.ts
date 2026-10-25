import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DASHBOARD_USERS_QUERY_KEY, listDashboardUsers, updateDashboardUserRole } from '../api/users'

export function useDashboardUsersQuery() {
  return useQuery({
    queryKey: DASHBOARD_USERS_QUERY_KEY,
    queryFn: listDashboardUsers,
  })
}

export function useUpdateDashboardUserRoleMutation() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'user' | 'admin' }) => updateDashboardUserRole(id, role),
    onSuccess: () => {
      toast.success(t('settings.users.updated'))
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_USERS_QUERY_KEY })
    },
    onError: (error: Error) => {
      toast.error(t('settings.users.updateFailed'), { description: error.message })
    },
  })
}
