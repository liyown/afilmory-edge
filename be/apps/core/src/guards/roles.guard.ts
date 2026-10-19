import type { HttpContextAuth } from '@core/context/http-context.values'
import { BizException, ErrorCode } from '@core/errors'
import { logger } from '@core/helpers/logger.helper'
import type { CanActivate, ExecutionContext } from '@tsuki-hono/common'
import { HttpContext } from '@tsuki-hono/common'
import { injectable } from 'tsyringe'

import type { AuthorizationRequirements } from './authorization.policy'
import { evaluateAuthorization, hasAuthorizationRequirements } from './authorization.policy'
import { getPlatformRoles, isAuthRequired } from './roles.decorator'

@injectable()
export class RolesGuard implements CanActivate {
  private readonly log = logger.extend('AuthorizationGuard')

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler()
    const targetClass = context.getClass()
    const requirements = this.resolveRequirements(handler, targetClass)
    if (!hasAuthorizationRequirements(requirements)) {
      return true
    }

    const store = context.getContext()
    const method = store?.hono?.req?.method ?? 'UNKNOWN'
    const path = store?.hono?.req?.path ?? 'UNKNOWN'
    const authContext = HttpContext.getValue('auth') as HttpContextAuth | undefined
    const platformRole = (authContext?.user as { role?: string } | undefined)?.role

    const decision = evaluateAuthorization(requirements, {
      authenticated: Boolean(authContext?.user && authContext.session),
      platformRole,
    })
    if (!decision.allowed) {
      if (decision.reason === 'unauthenticated') {
        this.log.warn(`Denied access: missing global session for ${method} ${path}`)
        throw new BizException(ErrorCode.AUTH_UNAUTHORIZED)
      }

      const userId = authContext?.user?.id ?? 'anonymous'
      this.deny(userId, method, path, `platform role=${platformRole ?? 'n/a'}`)
    }

    return true
  }

  private resolveRequirements(
    handler: ReturnType<ExecutionContext['getHandler']>,
    targetClass: object,
  ): AuthorizationRequirements {
    const handlerPlatformRoles = getPlatformRoles(handler)

    return {
      authRequired: isAuthRequired(handler) || isAuthRequired(targetClass),
      platformRoles: handlerPlatformRoles.length > 0 ? handlerPlatformRoles : getPlatformRoles(targetClass),
    }
  }

  private deny(userId: string, method: string, path: string, reason: string): never {
    const message = `Insufficient permissions for user ${userId}: ${reason} on ${method} ${path}`
    this.log.warn(message)
    throw new BizException(ErrorCode.AUTH_FORBIDDEN, { message })
  }
}
