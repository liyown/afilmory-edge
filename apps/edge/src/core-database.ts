import 'reflect-metadata'

import { tenants } from '@afilmory/db'
import { DatabaseModule } from '@core/database/database.module'
import { DbAccessor } from '@core/database/database.provider'
import { Controller, Get, Module } from '@tsuki-hono/common'
import type { HonoHttpApplication } from '@tsuki-hono/core'
import { createApplication } from '@tsuki-hono/core'
import { env as workerEnv } from 'cloudflare:workers'

interface ServiceProbe {
  status: 'ok' | 'error'
  latencyMs: number
  message?: string
  [key: string]: unknown
}

async function probe(check: () => Promise<Record<string, unknown>>): Promise<ServiceProbe> {
  const started = performance.now()
  try {
    const detail = await check()
    return { status: 'ok', latencyMs: elapsed(started), ...detail }
  }
  catch (error) {
    return {
      status: 'error',
      latencyMs: elapsed(started),
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100
}

@Controller('health')
export class DatabaseHealthController {
  constructor(private readonly dbAccessor: DbAccessor) {}

  // T7.2: liveness probe covering every storage binding the Worker depends on.
  @Get('/')
  async check() {
    const db = this.dbAccessor.get()

    const [database, storage, cache] = await Promise.all([
      probe(async () => {
        const [tenant] = await db
          .select({ id: tenants.id, slug: tenants.slug, status: tenants.status })
          .from(tenants)
          .limit(1)
        return { tenant: tenant ?? null }
      }),
      probe(async () => {
        const listed = await workerEnv.PHOTOS.list({ limit: 1 })
        return { objects: listed.objects.length }
      }),
      probe(async () => {
        await workerEnv.CACHE.get('health:probe')
        return {}
      }),
    ])

    const services = { database, storage, cache }
    const healthy = Object.values(services).every(service => service.status === 'ok')

    return {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services,
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
