import { dbSchema } from '@afilmory/db'
import { env } from 'cloudflare:workers'
import type { SQL } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { drizzle } from 'drizzle-orm/d1'
import { injectable } from 'tsyringe'

import type { AtomicBuilder } from './atomic'

/**
 * `execute()` is kept because several services issue raw probe queries; D1's
 * drizzle client only exposes `all()`.
 */
export type DrizzleDb = DrizzleD1Database<typeof dbSchema> & {
  execute: <T = Record<string, unknown>>(query: SQL) => Promise<{ rows: T[] }>
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
