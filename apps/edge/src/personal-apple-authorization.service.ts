import { BizException, ErrorCode } from '@core/errors'
import { injectable } from 'tsyringe'

export interface AppleAuthorizationInput {
  authorizationCode: string
  identityToken: string
  nonce: string
}

/**
 * T3.1: Apple sign-in (and its `apple_authorization` table) is not part of the
 * personal deployment. This replaces the Node service at build time so the
 * Worker graph stays limited to the tables that exist in D1.
 */
@injectable()
export class AppleAuthorizationService {
  async configuration(): Promise<{ appBundleIdentifier: string, enabled: boolean, webEnabled: boolean }> {
    return { appBundleIdentifier: 'app.afilmory', enabled: false, webEnabled: false }
  }

  async exchange(_userId: string, _input: AppleAuthorizationInput): Promise<void> {
    throw new BizException(ErrorCode.AUTH_FORBIDDEN, { message: 'Sign in with Apple is disabled.' })
  }

  async verifyReauthentication(_userId: string, _identityToken: string, _nonce: string): Promise<void> {
    throw new BizException(ErrorCode.AUTH_FORBIDDEN, { message: 'Sign in with Apple is disabled.' })
  }

  async resolveExistingProfile(_subject: string): Promise<{ email: string, name: string } | null> {
    return null
  }

  async revokeForUser(_userId: string): Promise<{ failed: number, revoked: number }> {
    return { failed: 0, revoked: 0 }
  }
}
