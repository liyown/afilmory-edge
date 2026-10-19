import './tenant.context'

import { DatabaseModule } from '@core/database/database.module'
import { Module } from '@tsuki-hono/common'

import { TenantRepository } from './tenant.repository'
import { TenantService } from './tenant.service'
import { TenantContextResolver } from './tenant-context-resolver.service'

@Module({
  imports: [DatabaseModule],
  providers: [TenantRepository, TenantService, TenantContextResolver],
})
export class TenantModule {}
