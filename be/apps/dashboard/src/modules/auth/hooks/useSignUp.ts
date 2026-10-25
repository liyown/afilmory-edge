import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { signUpAuth } from '../auth-client'

export interface SignUpRequest {
  name: string
  email: string
  password: string
}

export function useSignUp() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const signUpMutation = useMutation({
    mutationFn: async (data: SignUpRequest) => {
      const result = await signUpAuth.email({
        name: data.name.trim(),
        email: data.email.trim().toLowerCase(),
        password: data.password,
      })

      if (result.error) {
        throw new Error(result.error.message || 'Sign-up failed')
      }

      return result.data
    },
    onSuccess: () => {
      setErrorMessage(null)
      // New accounts are regular commenters, so land on the gallery rather
      // than the dashboard (which is reserved for staff).
      window.location.href = '/'
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || 'Sign-up failed. Please try again.')
    },
  })

  return {
    signUp: signUpMutation.mutate,
    isLoading: signUpMutation.isPending,
    error: errorMessage,
    clearError: () => setErrorMessage(null),
  }
}
