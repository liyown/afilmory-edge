import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import type { D1Target } from '../../src/modules/platform/setup/personal-admin'

export type {
  BootstrapOptions,
  BootstrapResult,
  D1Statement,
  D1Target,
  SeedOptions,
  SeedResult,
  SqlValue,
} from '../../src/modules/platform/setup/personal-admin'
export { createD1BindingTarget, seedPersonalAdmin } from '../../src/modules/platform/setup/personal-admin'

const SQLITE_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/migrations',
)

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
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
        authorization: `Bearer ${options.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const payload = (await response.json()) as CloudflareEnvelope<D1QueryResult[]>
    if (!response.ok || !payload.success) {
      const messages = payload.errors?.map((error) => error.message ?? 'unknown error').join('; ')
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
        batch: statements.map((statement) => ({ sql: statement.sql, params: statement.params })),
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
      } catch (error) {
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
    .filter((name) => name.endsWith('.sql'))
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
    .prepare("select name from sqlite_master where type = 'table' and name = 'manifest_state'")
    .get()
  if (!hasManifestState) {
    applySqliteMigrations(sqlite)
  }
  return createSqliteTarget(sqlite)
}
