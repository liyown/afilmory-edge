export const ROUTE_PATHS = {
  LOGIN: '/login',
  ROOT_LOGIN: '/root-login',
  WELCOME: '/welcome',
  TENANT_MISSING: '/tenant-missing',
  TENANT_RESTRICTED: '/tenant-restricted',
  DEFAULT_AUTHENTICATED: '/',
  NO_ACCESS: '/no-access',
} as const

export const PUBLIC_ROUTES = new Set<string>([
  ROUTE_PATHS.LOGIN,
  ROUTE_PATHS.ROOT_LOGIN,
  ROUTE_PATHS.WELCOME,
  ROUTE_PATHS.TENANT_MISSING,
  ROUTE_PATHS.TENANT_RESTRICTED,
  ROUTE_PATHS.NO_ACCESS,
])
