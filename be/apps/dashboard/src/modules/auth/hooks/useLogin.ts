import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { useSetAuthUser } from '~/atoms/auth'
import { getSafeRedirect } from '~/constants/routes'
import { AUTH_SESSION_QUERY_KEY, fetchSession } from '~/modules/auth/api/session'

import { signInAuth } from '../auth-client'

export interface LoginRequest {
  email: string
  password: string
  rememberMe?: boolean
}

export function useLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const setAuthUser = useSetAuthUser()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loginMutation = useMutation({
    mutationFn: async (data: LoginRequest) => {
      await signInAuth.email({
        email: data.email,
        password: data.password,
        rememberMe: data.rememberMe ?? true,
      })

      const session = await queryClient.fetchQuery({
        queryKey: AUTH_SESSION_QUERY_KEY,
        queryFn: fetchSession,
      })
      if (!session) {
        throw new Error('Sign-in completed without an active session.')
      }
      return session
    },
    onSuccess: (session) => {
      queryClient.setQueryData(AUTH_SESSION_QUERY_KEY, session)
      setAuthUser(session.user)
      setErrorMessage(null)
      const redirect = getSafeRedirect(new URLSearchParams(location.search).get('redirect'))
      navigate(redirect, { replace: true })
    },
    onError: (error: Error) => {
      if (error instanceof FetchError) {
        const status = error.statusCode ?? error.response?.status
        const serverMessage = (error.data as { message?: string } | undefined)?.message
        switch (status) {
          case 401: {
            setErrorMessage(serverMessage || 'Invalid email or password')
            break
          }
          case 403: {
            setErrorMessage(serverMessage || 'Access denied')
            break
          }
          case 429: {
            setErrorMessage('Too many attempts. Please try again later')
            break
          }
          default: {
            setErrorMessage(serverMessage || error.message || 'Login failed. Please try again')
          }
        }
      } else {
        console.error('error', error)
        setErrorMessage('An unexpected error occurred. Please try again')
      }
    },
  })

  const clearError = () => setErrorMessage(null)

  return {
    login: loginMutation.mutate,
    isLoading: loginMutation.isPending,
    error: errorMessage,
    clearError,
  }
}
