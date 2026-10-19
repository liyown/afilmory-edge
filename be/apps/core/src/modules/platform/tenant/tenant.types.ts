import type { tenants } from '@afilmory/db'

export type TenantRecord = typeof tenants.$inferSelect

export interface TenantAggregate {
  tenant: TenantRecord
}

export interface TenantContext extends TenantAggregate {
  readonly isPlaceholder?: boolean
  readonly requestedSlug?: string | null
}

export interface TenantResolutionInput {
  tenantId?: string | null
  slug?: string | null
}
