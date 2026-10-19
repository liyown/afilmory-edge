import { readFileSync } from 'node:fs'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'

import { generateId } from '@afilmory/db/schema.sqlite'

export const DEFAULT_TENANT_NAME = process.env.PERSONAL_TENANT_NAME ?? 'Afilmory'

const SQLITE_MIGRATION_PATH = new URL('../../../../packages/db/migrations-sqlite/0000_heavy_skin.sql', import.meta.url)

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
  slug: string
  tenantName?: string
}

export interface SeedResult {
  tenantId: string
  userId: string
  createdTenant: boolean
  createdUser: boolean
  createdMembership: boolean
}

function insertStatement(table: string, values: Record<string, SqlValue>): D1Statement {
  const columns = Object.keys(values)
  return {
    sql: `insert into ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) values (${columns.map(() => '?').join(', ')})`,
    params: columns.map(column => values[column] ?? null),
  }
}

export async function seedPersonalTenant(target: D1Target, options: SeedOptions): Promise<SeedResult> {
  const email = options.adminEmail.trim()
  if (email.length === 0) {
    throw new Error('adminEmail must not be empty')
  }

  const now = options.now ?? new Date().toISOString()
  const slug = options.slug.trim()
  const tenantName = options.tenantName?.trim() || DEFAULT_TENANT_NAME
  const adminName = options.adminName?.trim() || email.split('@')[0] || 'Admin'

  const [existingTenant] = await target.query<{ id: string }>('select "id" from "tenant" where "slug" = ? limit 1', [
    slug,
  ])
  const tenantId = existingTenant?.id ?? generateId()

  const [existingUser] = await target.query<{ id: string, role: string }>(
    'select "id", "role" from "auth_user" where lower(trim("email")) = lower(trim(?)) limit 1',
    [email],
  )
  const userId = existingUser?.id ?? generateId()

  const [existingMembership] = await target.query<{ id: string, role: string, status: string }>(
    'select "id", "role", "status" from "tenant_membership" where "tenant_id" = ? and "user_id" = ? limit 1',
    [tenantId, userId],
  )

  const statements: D1Statement[] = []

  if (!existingTenant) {
    statements.push(
      insertStatement('tenant', {
        id: tenantId,
        slug,
        name: tenantName,
        plan_id: 'free',
        storage_plan_id: null,
        banned: 0,
        status: 'active',
        created_at: now,
        updated_at: now,
      }),
    )
  }

  if (!existingUser) {
    statements.push(
      insertStatement('auth_user', {
        id: userId,
        name: adminName,
        email,
        email_verified: 1,
        role: 'superadmin',
        had_trial: 0,
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

  if (!existingMembership) {
    statements.push(
      insertStatement('tenant_membership', {
        id: generateId(),
        tenant_id: tenantId,
        user_id: userId,
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      }),
    )
  }
  else if (existingMembership.role !== 'owner' || existingMembership.status !== 'active') {
    statements.push({
      sql: 'update "tenant_membership" set "role" = ?, "status" = ?, "updated_at" = ? where "id" = ?',
      params: ['owner', 'active', now, existingMembership.id],
    })
  }

  statements.push({
    sql: 'insert into "tenant_manifest_state" ("tenant_id", "revision", "updated_at") values (?, ?, ?) on conflict ("tenant_id") do nothing',
    params: [tenantId, 0, now],
  })

  await target.batch(statements)

  return {
    tenantId,
    userId,
    createdTenant: !existingTenant,
    createdUser: !existingUser,
    createdMembership: !existingMembership,
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
  const migrations = readFileSync(SQLITE_MIGRATION_PATH, 'utf8')
  sqlite.exec(migrations)
}

export function openLocalTarget(path: string): D1Target {
  const sqlite = new DatabaseSync(path)
  const hasTenantTable = sqlite.prepare('select name from sqlite_master where type = \'table\' and name = \'tenant\'').get()
  if (!hasTenantTable) {
    applySqliteMigrations(sqlite)
  }
  return createSqliteTarget(sqlite)
}
