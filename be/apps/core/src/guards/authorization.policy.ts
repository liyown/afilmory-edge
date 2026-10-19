import type { PlatformRole } from './roles.decorator'

export interface AuthorizationRequirements {
  authRequired: boolean
  platformRoles: PlatformRole[]
}

export interface AuthorizationSubject {
  authenticated: boolean
  platformRole?: string | null
}

export type AuthorizationDecision
  = | { allowed: true }
    | {
      allowed: false
      reason: 'unauthenticated' | 'platform-role'
    }

export function hasAuthorizationRequirements(requirements: AuthorizationRequirements): boolean {
  return requirements.authRequired || requirements.platformRoles.length > 0
}

export function evaluateAuthorization(
  requirements: AuthorizationRequirements,
  subject: AuthorizationSubject,
): AuthorizationDecision {
  if (!hasAuthorizationRequirements(requirements)) {
    return { allowed: true }
  }

  if (!subject.authenticated) {
    return { allowed: false, reason: 'unauthenticated' }
  }

  if (
    requirements.platformRoles.length > 0
    && !requirements.platformRoles.includes(subject.platformRole as PlatformRole)
  ) {
    return { allowed: false, reason: 'platform-role' }
  }

  return { allowed: true }
}
