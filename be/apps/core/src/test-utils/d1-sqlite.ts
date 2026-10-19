import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/sqlite-proxy'

const MIGRATION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/migrations-sqlite/0000_heavy_skin.sql',
)

type ProxyQuery = {
  sql: string
  params: unknown[]
  method: string
}

function execute(sqlite: DatabaseSync, query: ProxyQuery): { rows: unknown[] } {
  const statement = sqlite.prepare(query.sql)
  const params = query.params as Parameters<typeof statement.all>

  if (query.method === 'run') {
    statement.run(...params)
    return { rows: [] }
  }

  // drizzle's SQLite row mapper indexes rows positionally.
  return { rows: statement.all(...params).map(row => Object.values(row)) }
}

/**
 * Emulates the D1 surface closely enough for plan tests: `runAtomically`
 * forwards the statement list to a single SQLite transaction, matching
 * `db.batch()` in the Worker runtime.
 */
export function createSqliteHarness(options?: { filename?: string, migrate?: boolean }) {
  const sqlite = new DatabaseSync(options?.filename ?? ':memory:')
  sqlite.exec('PRAGMA busy_timeout = 5000')

  if (options?.migrate !== false) {
    const migration = readFileSync(MIGRATION_PATH, 'utf8').replaceAll('--> statement-breakpoint', '')
    sqlite.exec(migration)
  }

  const db = drizzle(
    async (sql, params, method) => execute(sqlite, { sql, params: params as unknown[], method }),
    async (queries) => {
      sqlite.exec('BEGIN')
      try {
        const results = queries.map(query => execute(sqlite, query as ProxyQuery))
        sqlite.exec('COMMIT')
        return results
      }
      catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
    {},
  )

  const accessor = {
    get: () => db,
    runAtomically: async <TResult>(
      build: (tx: unknown) => Promise<{
        statements: readonly unknown[]
        resolve: (results: readonly unknown[]) => TResult
      }>,
    ): Promise<TResult> => {
      const plan = await build(db)
      if (plan.statements.length === 0) {
        return plan.resolve([])
      }

      return plan.resolve(await db.batch(plan.statements as never))
    },
  }

  return { sqlite, db, accessor }
}

export function seedTenant(sqlite: DatabaseSync, tenantId: string) {
  sqlite.prepare('insert into tenant (id, slug, name) values (?1, ?2, ?3)').run(tenantId, tenantId, tenantId)
}
