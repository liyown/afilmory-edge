import { Button, LinearBorderContainer } from '@afilmory/ui'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'

import { authorizeCli } from '~/modules/auth/api/daemon'
import { AUTH_SESSION_QUERY_KEY, fetchSession } from '~/modules/auth/api/session'

const PKCE_PATTERN = /^[\w-]{43}$/

function isLoopbackRedirect(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'http:' &&
      url.pathname === '/callback' &&
      Boolean(url.port) &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
    )
  } catch {
    return false
  }
}

export function Component() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const redirectUri = params.get('redirect_uri') ?? ''
  const state = params.get('state') ?? undefined
  const codeChallenge = params.get('code_challenge') ?? ''
  const name = params.get('name') ?? 'Afilmory Sync'
  const isValidRequest = isLoopbackRedirect(redirectUri) && PKCE_PATTERN.test(codeChallenge)

  const { data: session, isPending } = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: fetchSession,
    retry: false,
  })

  useEffect(() => {
    if (isPending || session) {
      return
    }
    const returnTo = encodeURIComponent(`${location.pathname}${location.search}`)
    navigate(`/login?redirect=${returnTo}`, { replace: true })
  }, [isPending, location.pathname, location.search, navigate, session])

  const respond = (values: Record<string, string | undefined>) => {
    if (!isLoopbackRedirect(redirectUri)) {
      return
    }
    const url = new URL(redirectUri)
    for (const [key, value] of Object.entries(values)) {
      if (value) {
        url.searchParams.set(key, value)
      }
    }
    window.location.assign(url.toString())
  }

  const handleAuthorize = async () => {
    if (!isValidRequest) {
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const result = await authorizeCli({
        name,
        redirectUri,
        codeChallenge,
        state,
      })
      respond({ code: result.code, state: result.state ?? state })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization failed. Please try again.')
      setIsSubmitting(false)
    }
  }

  if (isPending) {
    return (
      <div className="bg-background text-text-secondary flex min-h-dvh items-center justify-center text-sm">
        Checking session...
      </div>
    )
  }

  if (!session) {
    return null
  }

  return (
    <div className="bg-background flex min-h-dvh items-center justify-center">
      <LinearBorderContainer>
        <div className="bg-background-tertiary w-[560px] p-10">
          <div className="mb-6 flex items-start gap-4">
            <div className="bg-accent/10 text-accent flex size-11 shrink-0 items-center justify-center rounded-full">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h1 className="text-text mb-2 text-2xl font-bold">Authorize Afilmory Sync</h1>
              <p className="text-text-secondary text-sm">
                <span className="text-text font-medium">{name}</span> wants to connect to your photo library.
              </p>
            </div>
          </div>

          {!isValidRequest ? (
            <div className="border-red/60 bg-red/10 text-red mb-6 flex items-start gap-3 rounded-lg border px-4 py-3.5 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <p>This authorization link is invalid or expired. Run `afi login` again.</p>
            </div>
          ) : (
            <div className="border-fill/20 bg-fill/5 mb-6 rounded-lg border px-4 py-3.5 text-sm">
              <p className="text-text-secondary mb-2">This device will be able to:</p>
              <ul className="text-text-secondary list-disc space-y-1 pl-5">
                <li>Upload photos and videos to your library</li>
                <li>Update tags and manage uploaded assets</li>
              </ul>
              <p className="text-text-tertiary mt-3 text-xs">
                Only authorize a device you control. You can revoke access at any time with `afi logout -R`.
              </p>
            </div>
          )}

          {error && (
            <div className="border-red/60 bg-red/10 text-red mb-6 flex items-start gap-3 rounded-lg border px-4 py-3.5 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={() => respond({ error: 'access_denied', state })}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              className="flex-1"
              disabled={!isValidRequest}
              isLoading={isSubmitting}
              loadingText="Authorizing..."
              onClick={() => {
                void handleAuthorize()
              }}
            >
              Authorize
            </Button>
          </div>
        </div>
      </LinearBorderContainer>
    </div>
  )
}
