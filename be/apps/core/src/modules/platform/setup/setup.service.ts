import { env } from '@afilmory/env'
import { BizException, ErrorCode } from '@core/errors'
import { injectable } from 'tsyringe'

import type { D1DatabaseLike } from './personal-admin'
import { bootstrapPersonalAdmin, createD1BindingTarget, OwnerAlreadyExistsError } from './personal-admin'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

export interface SetupStatus {
  needsSetup: boolean
  setupEnabled: boolean
}

export interface CreateOwnerInput {
  token?: string
  email?: string
  name?: string
  password?: string
}

@injectable()
export class SetupService {
  private target() {
    if (!env.DB) {
      throw new BizException(ErrorCode.COMMON_INTERNAL_SERVER_ERROR, {
        message: 'The DB binding is missing',
      })
    }
    return createD1BindingTarget(env.DB as D1DatabaseLike)
  }

  async getStatus(): Promise<SetupStatus> {
    const rows = await this.target().query<{ count: number }>('select count(*) as "count" from "auth_user"')
    return {
      needsSetup: Number(rows[0]?.count ?? 0) === 0,
      setupEnabled: Boolean(env.SETUP_TOKEN),
    }
  }

  async createOwner(input: CreateOwnerInput): Promise<{ ok: true }> {
    const setupToken = env.SETUP_TOKEN
    if (!setupToken) {
      throw new BizException(ErrorCode.COMMON_FORBIDDEN, {
        message: 'Owner setup is disabled; set the SETUP_TOKEN secret and redeploy',
      })
    }
    if (!input?.token || !(await tokensMatch(input.token, setupToken))) {
      throw new BizException(ErrorCode.COMMON_FORBIDDEN, { message: 'Invalid setup token' })
    }

    const email = input.email?.trim().toLowerCase() ?? ''
    const password = input.password ?? ''
    if (!EMAIL_PATTERN.test(email)) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'A valid email is required' })
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, {
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      })
    }

    if (!(await this.getStatus()).needsSetup) {
      throw new BizException(ErrorCode.COMMON_CONFLICT, { message: 'An owner already exists' })
    }

    try {
      await bootstrapPersonalAdmin(this.target(), {
        email,
        name: input.name?.trim() || undefined,
        password,
        onlyIfEmpty: true,
      })
    } catch (error) {
      if (error instanceof OwnerAlreadyExistsError) {
        throw new BizException(ErrorCode.COMMON_CONFLICT, { message: 'An owner already exists' })
      }
      throw error
    }

    return { ok: true }
  }
}

async function tokensMatch(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const left = new Uint8Array(providedDigest)
  const right = new Uint8Array(expectedDigest)
  let difference = 0
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}
