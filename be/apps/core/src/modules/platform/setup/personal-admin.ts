import { generateId } from '@afilmory/db'
import { hashPassword } from 'better-auth/crypto'

export type SqlValue = null | number | string

export interface D1Statement {
  sql: string
  params: SqlValue[]
}

export interface D1Target {
  batch: (statements: readonly D1Statement[]) => Promise<void>
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlValue[],
  ) => Promise<T[]>
}

export interface SeedOptions {
  adminEmail: string
  adminName?: string
  now?: string
  /** First-run setup: refuse to create the user unless the table is empty. */
  onlyIfEmpty?: boolean
}

export class OwnerAlreadyExistsError extends Error {
  constructor() {
    super('An owner already exists')
  }
}

export interface SeedResult {
  userId: string
  createdUser: boolean
}

export interface BootstrapOptions {
  email: string
  name?: string
  now?: string
  password?: string
  onlyIfEmpty?: boolean
}

export interface BootstrapResult {
  accountCreated: boolean
  passwordChanged: boolean
  passwordGenerated: boolean
  password?: string
  seed: SeedResult
}

function insertStatement(table: string, values: Record<string, SqlValue>): D1Statement {
  const columns = Object.keys(values)
  return {
    sql: `insert into "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) values (${columns.map(() => '?').join(', ')})`,
    params: columns.map((column) => values[column] ?? null),
  }
}

/**
 * Creates (or repairs) the single personal administrator. Every step is
 * idempotent so the CLI can rerun it to rotate a password.
 */
export async function seedPersonalAdmin(target: D1Target, options: SeedOptions): Promise<SeedResult> {
  const email = options.adminEmail.trim()
  if (email.length === 0) {
    throw new Error('adminEmail must not be empty')
  }

  const now = options.now ?? new Date().toISOString()
  const adminName = options.adminName?.trim() || email.split('@')[0] || 'Admin'

  const [existingUser] = await target.query<{ id: string; role: string }>(
    'select "id", "role" from "auth_user" where lower(trim("email")) = lower(trim(?)) limit 1',
    [email],
  )
  // A concurrent claim can commit between the caller's empty check and this
  // query; whatever user it created, this call must not touch it.
  if (options.onlyIfEmpty && existingUser) {
    throw new OwnerAlreadyExistsError()
  }
  const userId = existingUser?.id ?? generateId()

  const statements: D1Statement[] = []

  if (!existingUser) {
    const values: Record<string, SqlValue> = {
      id: userId,
      name: adminName,
      email,
      email_verified: 1,
      role: 'superadmin',
      two_factor_enabled: 0,
      banned: 0,
      created_at: now,
      updated_at: now,
    }
    const insert = insertStatement('auth_user', values)
    if (options.onlyIfEmpty) {
      // Make the first-run check atomic: two simultaneous setup requests
      // cannot both create an owner. SQLite requires INSERT ... SELECT here.
      const columns = Object.keys(values)
      insert.sql = `insert into "auth_user" (${columns.map((column) => `"${column}"`).join(', ')}) select ${columns.map(() => '?').join(', ')} where not exists (select 1 from "auth_user")`
    }
    statements.push(insert)
  } else if (existingUser.role !== 'superadmin') {
    statements.push({
      sql: 'update "auth_user" set "role" = ?, "updated_at" = ? where "id" = ?',
      params: ['superadmin', now, userId],
    })
  }

  statements.push({
    sql: 'insert into "manifest_state" ("id", "revision", "updated_at") values (\'default\', 0, ?) on conflict ("id") do nothing',
    params: [now],
  })

  await target.batch(statements)

  if (options.onlyIfEmpty && !existingUser) {
    const [created] = await target.query<{ id: string }>('select "id" from "auth_user" where "id" = ? limit 1', [
      userId,
    ])
    if (!created) {
      throw new OwnerAlreadyExistsError()
    }
  }

  return {
    userId,
    createdUser: !existingUser,
  }
}

export async function bootstrapPersonalAdmin(target: D1Target, options: BootstrapOptions): Promise<BootstrapResult> {
  const email = options.email.trim().toLowerCase()
  if (email.length === 0) {
    throw new Error('Admin email must not be empty')
  }

  const now = options.now ?? new Date().toISOString()
  const seed = await seedPersonalAdmin(target, {
    adminEmail: email,
    adminName: options.name,
    now,
    onlyIfEmpty: options.onlyIfEmpty,
  })

  const [existingAccount] = await target.query<{ id: string }>(
    'select "id" from "auth_account" where "user_id" = ? and "provider_id" = ? limit 1',
    [seed.userId, 'credential'],
  )

  // Without an explicit password, reruns only repair the account and leave the
  // existing credential untouched; otherwise every rerun would lock the admin
  // out with a fresh random password.
  const shouldWritePassword = options.password !== undefined || !existingAccount
  const password = shouldWritePassword ? (options.password ?? randomPassword()) : undefined

  const statements: D1Statement[] = [
    {
      sql: 'update "auth_user" set "role" = ?, "email_verified" = ?, "updated_at" = ? where "id" = ?',
      params: ['superadmin', 1, now, seed.userId],
    },
  ]

  if (password !== undefined) {
    const passwordHash = await hashPassword(password)
    statements.push(
      existingAccount
        ? {
            sql: 'update "auth_account" set "password" = ?, "updated_at" = ? where "id" = ?',
            params: [passwordHash, now, existingAccount.id],
          }
        : {
            sql: 'insert into "auth_account" ("id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at") values (?, ?, ?, ?, ?, ?, ?)',
            params: [crypto.randomUUID(), seed.userId, 'credential', seed.userId, passwordHash, now, now],
          },
    )
  }

  await target.batch(statements)

  return {
    accountCreated: !existingAccount,
    password,
    passwordChanged: password !== undefined,
    passwordGenerated: shouldWritePassword && options.password === undefined,
    seed,
  }
}

function randomPassword(bytes = 16): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  let binary = ''
  for (const byte of buffer) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export interface D1PreparedStatementLike {
  bind: (...values: SqlValue[]) => D1PreparedStatementLike
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>
}

export interface D1DatabaseLike {
  prepare: (sql: string) => D1PreparedStatementLike
  batch: (statements: D1PreparedStatementLike[]) => Promise<unknown>
}

/** Adapts the Worker's D1 binding to the target interface used by the CLI. */
export function createD1BindingTarget(db: D1DatabaseLike): D1Target {
  return {
    async batch(statements) {
      if (statements.length === 0) {
        return
      }
      await db.batch(statements.map((statement) => db.prepare(statement.sql).bind(...statement.params)))
    },

    async query<T extends Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []) {
      const result = await db
        .prepare(sql)
        .bind(...params)
        .all<T>()
      return (result.results ?? []) as T[]
    },
  }
}
