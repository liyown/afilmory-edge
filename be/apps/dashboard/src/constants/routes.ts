export const ROUTE_PATHS = {
  LOGIN: '/login',
  CLI_AUTHORIZE: '/cli/authorize',
  DEFAULT_AUTHENTICATED: '/',
  NO_ACCESS: '/no-access',
} as const

export const PUBLIC_ROUTES = new Set<string>([ROUTE_PATHS.LOGIN, ROUTE_PATHS.CLI_AUTHORIZE, ROUTE_PATHS.NO_ACCESS])

export function getSafeRedirect(
  value: string | null | undefined,
  fallback = ROUTE_PATHS.DEFAULT_AUTHENTICATED,
): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback
  }
  if (value === ROUTE_PATHS.LOGIN || value.startsWith(`${ROUTE_PATHS.LOGIN}?`)) {
    return fallback
  }
  try {
    const parsed = new URL(value, 'https://afilmory.local')
    if (parsed.origin !== 'https://afilmory.local') {
      return fallback
    }
  } catch {
    return fallback
  }
  return value
}
