import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { generateId } from '@afilmory/db'

const SQLITE_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/migrations',
)

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

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

export interface SeedOptions {
  adminEmail: string
  adminName?: string
  now?: string
}

export interface SeedResult {
  userId: string
  createdUser: boolean
}

function insertStatement(table: string, values: Record<string, SqlValue>): D1Statement {
  const columns = Object.keys(values)
  return {
    sql: `insert into ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) values (${columns.map(() => '?').join(', ')})`,
    params: columns.map(column => values[column] ?? null),
  }
}

export async function seedPersonalAdmin(target: D1Target, options: SeedOptions): Promise<SeedResult> {
  const email = options.adminEmail.trim()
  if (email.length === 0) {
    throw new Error('adminEmail must not be empty')
  }

  const now = options.now ?? new Date().toISOString()
  const adminName = options.adminName?.trim() || email.split('@')[0] || 'Admin'

  const [existingUser] = await target.query<{ id: string, role: string }>(
    'select "id", "role" from "auth_user" where lower(trim("email")) = lower(trim(?)) limit 1',
    [email],
  )
  const userId = existingUser?.id ?? generateId()

  const statements: D1Statement[] = []

  if (!existingUser) {
    statements.push(
      insertStatement('auth_user', {
        id: userId,
        name: adminName,
        email,
        email_verified: 1,
        role: 'superadmin',
        two_factor_enabled: 0,
        banned: 0,
        created_at: now,
        updated_at: now,
      }),
    )
  }
  else if (existingUser.role !== 'superadmin') {
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

  return {
    userId,
    createdUser: !existingUser,
  }
}

export interface HttpD1TargetOptions {
  accountId: string
  apiToken: string
  databaseId: string
  fetchImpl?: typeof fetch
}

interface D1QueryResult {
  error?: string
  results?: Array<Record<string, unknown>>
  success: boolean
}

interface CloudflareEnvelope<T> {
  errors?: Array<{ message?: string }>
  result?: T
  success: boolean
}

export function createHttpD1Target(options: HttpD1TargetOptions): D1Target {
  const fetchImpl = options.fetchImpl ?? fetch
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/d1/database/${encodeURIComponent(options.databaseId)}/query`

  const request = async (body: unknown): Promise<D1QueryResult[]> => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${options.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const payload = (await response.json()) as CloudflareEnvelope<D1QueryResult[]>
    if (!response.ok || !payload.success) {
      const messages = payload.errors?.map(error => error.message ?? 'unknown error').join('; ')
      throw new Error(`D1 request failed (${response.status}): ${messages ?? 'unknown error'}`)
    }
    return payload.result ?? []
  }

  return {
    async batch(statements) {
      if (statements.length === 0) {
        return
      }
      const results = await request({
        batch: statements.map(statement => ({ sql: statement.sql, params: statement.params })),
      })
      for (const [index, result] of results.entries()) {
        if (!result.success) {
          throw new Error(`D1 batch statement ${index} failed: ${result.error ?? 'unknown error'}`)
        }
      }
    },

    async query(sql, params = []) {
      const [result] = await request({ sql, params })
      if (!result) {
        return []
      }
      if (!result.success) {
        throw new Error(`D1 query failed: ${result.error ?? 'unknown error'}`)
      }
      return (result.results ?? []) as never
    },
  }
}

export function createSqliteTarget(sqlite: DatabaseSync): D1Target {
  sqlite.exec('pragma foreign_keys = on')
  return {
    async batch(statements) {
      sqlite.exec('begin')
      try {
        for (const statement of statements) {
          sqlite.prepare(statement.sql).run(...statement.params)
        }
        sqlite.exec('commit')
      }
      catch (error) {
        sqlite.exec('rollback')
        throw error
      }
    },

    async query(sql, params = []) {
      return sqlite.prepare(sql).all(...params) as never
    },
  }
}

export function applySqliteMigrations(sqlite: DatabaseSync): void {
  const migrations = readdirSync(SQLITE_MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort()
  for (const migrationFile of migrations) {
    const migration = readFileSync(path.join(SQLITE_MIGRATIONS_DIR, migrationFile), 'utf8').replaceAll(
      '--> statement-breakpoint',
      '',
    )
    sqlite.exec(migration)
  }
}

export function openLocalTarget(path: string): D1Target {
  const sqlite = new DatabaseSync(path)
  const hasManifestState = sqlite
    .prepare('select name from sqlite_master where type = \'table\' and name = \'manifest_state\'')
    .get()
  if (!hasManifestState) {
    applySqliteMigrations(sqlite)
  }
  return createSqliteTarget(sqlite)
}
