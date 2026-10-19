import { describe, expect, it } from 'vitest'

import type { AuthorizationRequirements } from './authorization.policy'
import { evaluateAuthorization } from './authorization.policy'

const publicRoute: AuthorizationRequirements = {
  authRequired: false,
  platformRoles: [],
}

const authenticatedRoute: AuthorizationRequirements = {
  authRequired: true,
  platformRoles: [],
}

const platformAdminRoute: AuthorizationRequirements = {
  authRequired: false,
  platformRoles: ['superadmin'],
}

describe('evaluateAuthorization', () => {
  it('keeps public routes accessible without a global session', () => {
    expect(evaluateAuthorization(publicRoute, { authenticated: false })).toEqual({ allowed: true })
  })

  it('allows authenticated routes with a global session', () => {
    expect(
      evaluateAuthorization(authenticatedRoute, {
        authenticated: true,
        platformRole: 'user',
      }),
    ).toEqual({ allowed: true })
  })

  it('rejects unauthenticated access to protected routes', () => {
    expect(evaluateAuthorization(authenticatedRoute, { authenticated: false })).toEqual({
      allowed: false,
      reason: 'unauthenticated',
    })
  })

  it('requires the configured platform role', () => {
    expect(
      evaluateAuthorization(platformAdminRoute, {
        authenticated: true,
        platformRole: 'superadmin',
      }),
    ).toEqual({ allowed: true })

    expect(
      evaluateAuthorization(platformAdminRoute, {
        authenticated: true,
        platformRole: 'user',
      }),
    ).toEqual({ allowed: false, reason: 'platform-role' })
  })
})
