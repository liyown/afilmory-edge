import 'reflect-metadata'

import { tenants } from '@afilmory/db'
import { DatabaseModule } from '@core/database/database.module'
import { DbAccessor } from '@core/database/database.provider'
import { Controller, Get, Module } from '@tsuki-hono/common'
import type { HonoHttpApplication } from '@tsuki-hono/core'
import { createApplication } from '@tsuki-hono/core'

@Controller('health')
export class DatabaseHealthController {
  constructor(private readonly dbAccessor: DbAccessor) {}

  @Get('/')
  async check() {
    const started = performance.now()
    const db = this.dbAccessor.get()

    try {
      const [tenant] = await db
        .select({ id: tenants.id, slug: tenants.slug, status: tenants.status })
        .from(tenants)
        .limit(1)

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          database: {
            status: 'ok',
            latencyMs: Math.round((performance.now() - started) * 100) / 100,
            tenant: tenant ?? null,
          },
        },
      }
    }
    catch (error) {
      return {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        services: {
          database: {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        },
      }
    }
  }
}

@Module({
  imports: [DatabaseModule],
  controllers: [DatabaseHealthController],
})
export class EdgeDatabaseModule {}

let applicationPromise: Promise<HonoHttpApplication> | undefined

/** Lazily boot the DI graph so the first request pays the startup cost. */
export function getDatabaseHealthApp(): Promise<HonoHttpApplication> {
  if (!applicationPromise) {
    applicationPromise = createApplication(EdgeDatabaseModule, { globalPrefix: '/api' })
  }
  return applicationPromise
}
