import { Button, Input, Label } from '@afilmory/ui'
import { CircleAlert } from 'lucide-react'
import { useState } from 'react'

import { useSetup } from '../hooks/useSetup'

const MIN_PASSWORD_LENGTH = 8

export interface OwnerSetupFormProps {
  onCreated: (email: string) => void
}

export function OwnerSetupForm({ onCreated }: OwnerSetupFormProps) {
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const { createOwner, isCreating, error, clearError } = useSetup((input) => onCreated(input.email))

  const passwordMismatch = confirmPassword.length > 0 && confirmPassword !== password
  const canSubmit =
    Boolean(token.trim()) &&
    Boolean(email.trim()) &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirmPassword

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    createOwner({
      token: token.trim(),
      email: email.trim(),
      name: name.trim() || undefined,
      password,
    })
  }

  const resetError = () => {
    if (error) {
      clearError()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-background-tertiary relative w-[600px]">
      <div className="p-10">
        <div className="mb-8">
          <h1 className="text-text mb-2 text-3xl font-bold">Create your owner account</h1>
          <p className="text-text-secondary text-sm">
            This deployment has no administrator yet. Enter the setup token you configured to claim it.
          </p>
        </div>

        {error && (
          <div className="border-red/60 bg-red/10 mb-6 rounded-lg border px-4 py-3.5">
            <div className="flex items-start gap-3">
              <CircleAlert className="text-red mt-0.5 size-4" />
              <p className="text-red flex-1 text-sm">{error}</p>
            </div>
          </div>
        )}

        <div className="mb-5 space-y-2">
          <Label htmlFor="setup-token">Setup token</Label>
          <Input
            id="setup-token"
            type="password"
            placeholder="The SETUP_TOKEN secret"
            value={token}
            onChange={(event) => {
              setToken(event.target.value)
              resetError()
            }}
            disabled={isCreating}
            autoComplete="off"
            autoFocus
          />
        </div>

        <div className="mb-5 space-y-2">
          <Label htmlFor="setup-email">Email</Label>
          <Input
            id="setup-email"
            type="email"
            placeholder="your.email@example.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              resetError()
            }}
            disabled={isCreating}
            autoComplete="email"
          />
        </div>

        <div className="mb-5 space-y-2">
          <Label htmlFor="setup-name">Display name</Label>
          <Input
            id="setup-name"
            type="text"
            placeholder="Optional"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              resetError()
            }}
            disabled={isCreating}
            autoComplete="name"
          />
        </div>

        <div className="mb-5 space-y-2">
          <Label htmlFor="setup-password">Password</Label>
          <Input
            id="setup-password"
            type="password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              resetError()
            }}
            disabled={isCreating}
            autoComplete="new-password"
          />
        </div>

        <div className="mb-6 space-y-2">
          <Label htmlFor="setup-confirm-password">Confirm password</Label>
          <Input
            id="setup-confirm-password"
            type="password"
            placeholder="Repeat the password"
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value)
              resetError()
            }}
            disabled={isCreating}
            error={passwordMismatch}
            autoComplete="new-password"
          />
          {passwordMismatch && <p className="text-red text-xs">Passwords do not match.</p>}
        </div>

        <Button
          type="submit"
          variant="primary"
          size="md"
          className="w-full"
          disabled={!canSubmit}
          isLoading={isCreating}
          loadingText="Creating account..."
        >
          Create owner
        </Button>
      </div>
    </form>
  )
}
