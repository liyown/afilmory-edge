import { AsyncLocalStorage } from 'node:async_hooks'

import { dbSchema } from '@afilmory/db'
import { createLogger } from '@tsuki-hono/common'
import { env } from 'cloudflare:workers'
import type { SQL } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { drizzle } from 'drizzle-orm/d1'
import { injectable } from 'tsyringe'

import type { AtomicBuilder } from './atomic'

const dbContext = new AsyncLocalStorage<DatabaseContextStore>()
const logger = createLogger('DB')
const SELECT_ONE_PATTERN = /^\s*select\s+1\b/i

/**
 * node-postgres exposes `execute()` returning `{ rows }`. D1 drizzle only
 * exposes `all()`, so the provider adds the `execute` shape on top.
 */
export type DrizzleDb = DrizzleD1Database<typeof dbSchema> & {
  execute: <T = Record<string, unknown>>(query: SQL) => Promise<{ rows: T[] }>
}

export interface DatabaseContextStore {
  transaction?: {
    client: D1PoolClient
  }
  db?: DrizzleDb
  tenantIsolation?: {
    tenantId?: string | null
    isSuperAdmin?: boolean
  }
}

export function runWithDbContext<T>(fn: () => Promise<T> | T) {
  return new Promise<T>((resolve, reject) => {
    dbContext.run({}, () => {
      Promise.resolve(fn()).then(resolve).catch(reject)
    })
  })
}

export function getOptionalDbContext(): DatabaseContextStore | undefined {
  return dbContext.getStore()
}

/**
 * D1 has no row-level security. Tenant filters live in the queries themselves,
 * so there is nothing to configure on the connection.
 */
export async function applyTenantIsolationContext(_options?: {
  tenantId?: string | null
  isSuperAdmin?: boolean
}): Promise<void> {}

class D1PoolClient {
  async query(query: string): Promise<{ rows: unknown[] }> {
    if (SELECT_ONE_PATTERN.test(query)) {
      const row = await env.DB.prepare('select 1 as ok').first()
      return { rows: [row] }
    }

    // BEGIN / COMMIT / ROLLBACK / set_config are PostgreSQL concepts. D1 runs
    // each statement atomically on its own, so these are no-ops.
    return { rows: [] }
  }

  release(): void {}
}

class D1Pool {
  async connect(): Promise<D1PoolClient> {
    return new D1PoolClient()
  }
}

/**
 * Keeps the `PgPoolProvider` surface so middleware/health code compiles
 * unchanged; queries go through D1 instead of a connection pool.
 */
@injectable()
export class PgPoolProvider {
  private readonly pool = new D1Pool()

  getPool(): D1Pool {
    return this.pool
  }

  async warmup(): Promise<void> {
    await env.DB.prepare('select 1').first()
    logger.info('D1 binding reachable')
  }
}

@injectable()
export class DrizzleProvider {
  private db?: DrizzleDb

  getDb(): DrizzleDb {
    if (!this.db) {
      const base = drizzle(env.DB, { schema: dbSchema })
      const db = base as unknown as DrizzleDb
      db.execute = async <T = Record<string, unknown>>(query: SQL) => ({
        rows: await base.all<T>(query),
      })
      this.db = db
    }
    return this.db
  }
}

@injectable()
export class DbAccessor {
  constructor(private readonly provider: DrizzleProvider) {}

  get(): DrizzleDb {
    return this.provider.getDb()
  }

  async runAtomically<TResult>(build: AtomicBuilder<DrizzleDb, TResult>): Promise<TResult> {
    const db = this.get()
    const plan = await build(db)
    if (plan.statements.length === 0) {
      return plan.resolve([])
    }

    const statements = plan.statements as Parameters<typeof db.batch>[0]
    return plan.resolve(await db.batch(statements))
  }
}
