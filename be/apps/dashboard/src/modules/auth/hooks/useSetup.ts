import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { useState } from 'react'

import type { CreateOwnerInput } from '../api/setup'
import { createOwner, SETUP_STATUS_QUERY_KEY } from '../api/setup'

export function useSetup(onCreated?: (input: CreateOwnerInput) => void) {
  const queryClient = useQueryClient()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: createOwner,
    onSuccess: async (_result, input) => {
      setErrorMessage(null)
      await queryClient.invalidateQueries({ queryKey: SETUP_STATUS_QUERY_KEY })
      onCreated?.(input)
    },
    onError: (error: Error) => {
      if (error instanceof FetchError) {
        const serverMessage = (error.data as { message?: string } | undefined)?.message
        setErrorMessage(serverMessage || error.message || 'Setup failed. Please try again')
        return
      }
      console.error('setup error', error)
      setErrorMessage('An unexpected error occurred. Please try again')
    },
  })

  return {
    createOwner: mutation.mutate,
    isCreating: mutation.isPending,
    error: errorMessage,
    clearError: () => setErrorMessage(null),
  }
}
