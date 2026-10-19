export const ROUTE_PATHS = {
  LOGIN: '/login',
  DEFAULT_AUTHENTICATED: '/',
  NO_ACCESS: '/no-access',
} as const

export const PUBLIC_ROUTES = new Set<string>([ROUTE_PATHS.LOGIN, ROUTE_PATHS.NO_ACCESS])
