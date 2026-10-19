import { DatabaseSync } from 'node:sqlite'

import { BizException, ErrorCode } from '@core/errors'
import { verifyPassword } from 'better-auth/crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applySqliteMigrations } from '../../../../scripts/lib/d1-target'
import type { D1DatabaseLike, SqlValue } from './personal-admin'
import { SetupService } from './setup.service'

const envState = vi.hoisted(() => ({}) as Record<string, unknown>)

vi.mock('@afilmory/env', () => ({
  env: new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => (typeof key === 'string' ? envState[key] : undefined),
  }),
}))

interface FakeStatement {
  sql: string
  params: SqlValue[]
  bind: (...values: SqlValue[]) => FakeStatement
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>
}

function createFakeD1(sqlite: DatabaseSync): D1DatabaseLike {
  return {
    prepare(sql) {
      let params: SqlValue[] = []
      const statement: FakeStatement = {
        sql,
        get params() {
          return params
        },
        bind(...values) {
          params = values
          return statement
        },
        async all<T = Record<string, unknown>>() {
          return { results: sqlite.prepare(sql).all(...params) as T[] }
        },
      }
      return statement
    },
    async batch(statements) {
      sqlite.exec('begin')
      try {
        for (const statement of statements as unknown as FakeStatement[]) {
          sqlite.prepare(statement.sql).run(...statement.params)
        }
        sqlite.exec('commit')
      } catch (error) {
        sqlite.exec('rollback')
        throw error
      }
    },
  }
}

async function expectBizError(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(BizException)
    expect((error as BizException).code).toBe(code)
    return
  }
  throw new Error('Expected the call to fail')
}

describe('setupService', () => {
  let sqlite: DatabaseSync
  let service: SetupService

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:')
    applySqliteMigrations(sqlite)
    envState.DB = createFakeD1(sqlite)
    delete envState.SETUP_TOKEN
    service = new SetupService()
  })

  afterEach(() => {
    delete envState.DB
    delete envState.SETUP_TOKEN
    sqlite.close()
  })

  it('reports the setup state from the user table and the token binding', async () => {
    await expect(service.getStatus()).resolves.toEqual({ needsSetup: true, setupEnabled: false })

    envState.SETUP_TOKEN = 'setup-secret'
    await expect(service.getStatus()).resolves.toEqual({ needsSetup: true, setupEnabled: true })
  })

  it('refuses to claim the owner without a configured or matching token', async () => {
    const input = { token: 'setup-secret', email: 'owner@example.com', password: 'Password123!' }

    await expectBizError(service.createOwner(input), ErrorCode.COMMON_FORBIDDEN)

    envState.SETUP_TOKEN = 'setup-secret'
    await expectBizError(service.createOwner({ ...input, token: 'wrong-token' }), ErrorCode.COMMON_FORBIDDEN)
    await expect(service.getStatus()).resolves.toMatchObject({ needsSetup: true })
  })

  it('validates the email and password before creating the owner', async () => {
    envState.SETUP_TOKEN = 'setup-secret'

    await expectBizError(
      service.createOwner({ token: 'setup-secret', email: 'not-an-email', password: 'Password123!' }),
      ErrorCode.COMMON_BAD_REQUEST,
    )
    await expectBizError(
      service.createOwner({ token: 'setup-secret', email: 'owner@example.com', password: 'short' }),
      ErrorCode.COMMON_BAD_REQUEST,
    )
  })

  it('creates a working superadmin once and then reports setup as complete', async () => {
    envState.SETUP_TOKEN = 'setup-secret'

    await expect(
      service.createOwner({
        token: 'setup-secret',
        email: 'Owner@Example.com',
        name: 'Owner',
        password: 'Password123!',
      }),
    ).resolves.toEqual({ ok: true })

    await expect(service.getStatus()).resolves.toMatchObject({ needsSetup: false })

    const [user] = sqlite
      .prepare('select "id", "email", "name", "role", "email_verified" from "auth_user"')
      .all() as Array<Record<string, unknown>>
    expect(user).toMatchObject({
      email: 'owner@example.com',
      name: 'Owner',
      role: 'superadmin',
      email_verified: 1,
    })

    const [account] = sqlite
      .prepare('select "password" from "auth_account" where "user_id" = ? and "provider_id" = ?')
      .all(user.id as string, 'credential') as Array<{ password: string }>
    expect(await verifyPassword({ hash: account.password, password: 'Password123!' })).toBe(true)

    await expectBizError(
      service.createOwner({ token: 'setup-secret', email: 'other@example.com', password: 'Password123!' }),
      ErrorCode.COMMON_CONFLICT,
    )
  })

  it('lets only one of two simultaneous claims win', async () => {
    envState.SETUP_TOKEN = 'setup-secret'

    const first = service.createOwner({
      token: 'setup-secret',
      email: 'first@example.com',
      password: 'Password123!',
    })
    const second = service.createOwner({
      token: 'setup-secret',
      email: 'second@example.com',
      password: 'Password123!',
    })

    const results = await Promise.allSettled([first, second])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(BizException)
    expect(rejected.reason.code).toBe(ErrorCode.COMMON_CONFLICT)

    const users = sqlite.prepare('select "email" from "auth_user"').all() as Array<{ email: string }>
    expect(users).toHaveLength(1)
  })
})
