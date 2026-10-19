import { DatabaseSync } from 'node:sqlite'

import { verifyPassword } from 'better-auth/crypto'
import { describe, expect, it } from 'vitest'

import { bootstrapPersonalAdmin } from './bootstrap-admin'
import { applySqliteMigrations, createSqliteTarget, seedPersonalAdmin } from './lib/d1-target'

function createTarget() {
  const sqlite = new DatabaseSync(':memory:')
  applySqliteMigrations(sqlite)
  return createSqliteTarget(sqlite)
}

async function readCredentialHash(target: ReturnType<typeof createTarget>, userId: string): Promise<string> {
  const [account] = await target.query<{ password: string }>(
    'select "password" from "auth_account" where "user_id" = ? and "provider_id" = ?',
    [userId, 'credential'],
  )
  expect(account).toBeDefined()
  return account.password
}

describe('bootstrapPersonalAdmin', () => {
  it('creates a superadmin and working credential account', async () => {
    const target = createTarget()
    const result = await bootstrapPersonalAdmin(target, {
      email: 'Admin@Example.com',
      name: 'Admin',
      password: 'Password123!',
    })

    expect(result.seed.createdUser).toBe(true)
    expect(result.accountCreated).toBe(true)
    expect(result.passwordChanged).toBe(true)
    expect(result.passwordGenerated).toBe(false)

    const users = await target.query<{ email: string, email_verified: number, role: string }>(
      'select "email", "email_verified", "role" from "auth_user"',
    )
    expect(users).toEqual([{ email: 'admin@example.com', email_verified: 1, role: 'superadmin' }])

    const [manifest] = await target.query<{ id: string, revision: number }>(
      'select "id", "revision" from "manifest_state"',
    )
    expect(manifest).toEqual({ id: 'default', revision: 0 })

    const hash = await readCredentialHash(target, result.seed.userId)
    expect(await verifyPassword({ hash, password: 'Password123!' })).toBe(true)
    expect(await verifyPassword({ hash, password: 'wrong-password' })).toBe(false)
  })

  it('is idempotent and keeps the existing password when none is provided', async () => {
    const target = createTarget()
    const first = await bootstrapPersonalAdmin(target, {
      email: 'admin@example.com',
      password: 'Password123!',
    })
    const hashBefore = await readCredentialHash(target, first.seed.userId)

    const second = await bootstrapPersonalAdmin(target, { email: 'ADMIN@example.com' })

    expect(second.seed.createdUser).toBe(false)
    expect(second.accountCreated).toBe(false)
    expect(second.passwordChanged).toBe(false)
    expect(second.passwordGenerated).toBe(false)
    expect(second.seed.userId).toBe(first.seed.userId)
    expect(await readCredentialHash(target, first.seed.userId)).toBe(hashBefore)

    const [counts] = await target.query<{ accounts: number, users: number }>(
      'select (select count(*) from "auth_user") as "users", (select count(*) from "auth_account") as "accounts"',
    )
    expect(counts).toEqual({ accounts: 1, users: 1 })
  })

  it('rotates the password when one is supplied on a rerun', async () => {
    const target = createTarget()
    const first = await bootstrapPersonalAdmin(target, {
      email: 'admin@example.com',
      password: 'Password123!',
    })

    const second = await bootstrapPersonalAdmin(target, {
      email: 'admin@example.com',
      password: 'NewPassword456!',
    })

    expect(second.passwordChanged).toBe(true)
    expect(second.accountCreated).toBe(false)
    const hash = await readCredentialHash(target, first.seed.userId)
    expect(await verifyPassword({ hash, password: 'NewPassword456!' })).toBe(true)
    expect(await verifyPassword({ hash, password: 'Password123!' })).toBe(false)
  })

  it('generates a password when the migrated user has no credential account', async () => {
    const target = createTarget()
    const seed = await seedPersonalAdmin(target, { adminEmail: 'admin@example.com' })

    const result = await bootstrapPersonalAdmin(target, { email: 'admin@example.com' })

    expect(result.seed.createdUser).toBe(false)
    expect(result.accountCreated).toBe(true)
    expect(result.passwordGenerated).toBe(true)
    expect(result.password).toMatch(/^[\w-]{22}$/)

    const hash = await readCredentialHash(target, seed.userId)
    expect(await verifyPassword({ hash, password: result.password! })).toBe(true)
  })
})
