import type { tenantDomains } from '@afilmory/db'

import type { TenantAggregate } from './tenant.types'

export type TenantDomainRecord = typeof tenantDomains.$inferSelect

export interface TenantDomainAggregate extends TenantAggregate {
  domain: TenantDomainRecord
}
