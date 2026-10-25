import { Button, Input, Label, LinearBorderContainer } from '@afilmory/ui'
import { Spring } from '@afilmory/utils'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { m } from 'motion/react'
import { useState } from 'react'

import { fetchSetupStatus, SETUP_STATUS_QUERY_KEY } from '~/modules/auth/api/setup'
import { OwnerSetupForm } from '~/modules/auth/components/OwnerSetupForm'
import { SocialAuthButtons } from '~/modules/auth/components/SocialAuthButtons'
import { useLogin } from '~/modules/auth/hooks/useLogin'
import { useSignUp } from '~/modules/auth/hooks/useSignUp'

type AuthMode = 'login' | 'signup'

export function Component() {
  const [mode, setMode] = useState<AuthMode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const loginState = useLogin()
  const signUpState = useSignUp()
  const isLoading = loginState.isLoading || signUpState.isLoading
  const error = mode === 'login' ? loginState.error : signUpState.error
  const { data: setupStatus, isPending: isCheckingSetup } = useQuery({
    queryKey: SETUP_STATUS_QUERY_KEY,
    queryFn: fetchSetupStatus,
  })

  const clearError = () => {
    loginState.clearError()
    signUpState.clearError()
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!email.trim() || !password.trim()) {
      return
    }

    if (mode === 'signup') {
      if (!name.trim()) {
        return
      }
      signUpState.signUp({ name: name.trim(), email: email.trim(), password })
      return
    }

    loginState.login({ email: email.trim(), password })
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value)
    if (error) {
      clearError()
    }
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value)
    if (error) {
      clearError()
    }
  }

  if (isCheckingSetup) {
    return (
      <div className="relative flex min-h-dvh flex-1 flex-col">
        <div className="bg-background text-text-secondary flex flex-1 items-center justify-center text-sm">
          Checking deployment...
        </div>
      </div>
    )
  }

  if (setupStatus?.needsSetup) {
    return (
      <div className="relative flex min-h-dvh flex-1 flex-col">
        <div className="bg-background flex flex-1 items-center justify-center">
          <LinearBorderContainer>
            {setupStatus.setupEnabled ? (
              <OwnerSetupForm onCreated={setEmail} />
            ) : (
              <div className="bg-background-tertiary w-[600px] p-10">
                <h1 className="text-text mb-2 text-3xl font-bold">Setup required</h1>
                <p className="text-text-secondary text-sm">
                  No administrator exists yet. Set the <code className="text-text">SETUP_TOKEN</code> secret for this
                  Worker and reload this page to create the owner account.
                </p>
              </div>
            )}
          </LinearBorderContainer>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-dvh flex-1 flex-col">
      <div className="bg-background flex flex-1 items-center justify-center">
        <LinearBorderContainer>
          <form onSubmit={handleSubmit} className="bg-background-tertiary relative w-[600px]">
            <div className="p-10">
              <div className="mb-8">
                <h1 className="text-text mb-2 text-3xl font-bold">{mode === 'login' ? 'Login' : 'Create account'}</h1>
                <p className="text-text-secondary text-sm">
                  {mode === 'login'
                    ? 'Enter your credentials to access the dashboard'
                    : 'Sign up to comment on photos and join the community'}
                </p>
              </div>

              {error && (
                <m.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={Spring.presets.snappy}
                  className="border-red/60 bg-red/10 mb-6 rounded-lg border px-4 py-3.5"
                >
                  <div className="flex items-start gap-3">
                    <CircleAlert className="text-red mt-0.5 size-4" />
                    <p className="text-red flex-1 text-sm">{error}</p>
                  </div>
                </m.div>
              )}

              {mode === 'signup' && (
                <div className="mb-5 space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                      if (error) {
                        clearError()
                      }
                    }}
                    disabled={isLoading}
                    error={!!error}
                    autoComplete="name"
                    autoFocus
                  />
                </div>
              )}

              <div className="mb-5 space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your.email@example.com"
                  value={email}
                  onChange={handleEmailChange}
                  disabled={isLoading}
                  error={!!error}
                  autoComplete="email"
                  autoFocus={mode === 'login'}
                />
              </div>

              <div className="mb-6 space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={mode === 'signup' ? 'Choose a password' : 'Enter your password'}
                  value={password}
                  onChange={handlePasswordChange}
                  disabled={isLoading}
                  error={!!error}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full"
                disabled={!email.trim() || !password.trim() || (mode === 'signup' && !name.trim())}
                isLoading={isLoading}
                loadingText={mode === 'signup' ? 'Creating account...' : 'Signing in...'}
              >
                {mode === 'signup' ? 'Create account' : 'Sign In'}
              </Button>

              <p className="text-text-secondary mt-5 text-center text-sm">
                {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => {
                    clearError()
                    setMode(mode === 'signup' ? 'login' : 'signup')
                  }}
                >
                  {mode === 'signup' ? 'Sign in' : 'Sign up'}
                </button>
              </p>

              <div className="relative my-8">
                <div className="absolute inset-0 flex items-center">
                  <div className="via-text/20 h-[0.5px] w-full bg-linear-to-r from-transparent to-transparent" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background-tertiary text-text-tertiary px-3 tracking-wide">Or continue with</span>
                </div>
              </div>

              <SocialAuthButtons layout="row" title="" />
            </div>
          </form>
        </LinearBorderContainer>
      </div>
    </div>
  )
}
