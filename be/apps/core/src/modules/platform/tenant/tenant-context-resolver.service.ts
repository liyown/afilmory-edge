import type { OnModuleInit } from '@tsuki-hono/common'
import { HttpContext } from '@tsuki-hono/common'
import type { Context } from 'hono'
import { injectable } from 'tsyringe'

import { TenantService } from './tenant.service'
import type { TenantContext } from './tenant.types'

export interface TenantResolutionOptions {
  throwOnMissing?: boolean
  skipInitializationCheck?: boolean
}

/**
 * Single-site shim (§2.2): every request resolves to the one root tenant row.
 * Photo/comment/reaction services keep their `tenantId` filters unchanged.
 */
@injectable()
export class TenantContextResolver implements OnModuleInit {
  private rootTenantPromise: Promise<TenantContext> | null = null

  constructor(private readonly tenantService: TenantService) {}

  async onModuleInit(): Promise<void> {
    await this.getRootTenant()
  }

  async resolve(_context: Context, _options: TenantResolutionOptions = {}): Promise<TenantContext> {
    const existing = this.getExistingContext()
    if (existing) {
      return existing
    }

    return await this.getRootTenant()
  }

  private async getRootTenant(): Promise<TenantContext> {
    if (!this.rootTenantPromise) {
      this.rootTenantPromise = this.tenantService
        .ensureRootTenant()
        .then(aggregate => ({
          tenant: aggregate.tenant,
          isPlaceholder: false,
          requestedSlug: aggregate.tenant.slug,
        }))
        .catch((error) => {
          this.rootTenantPromise = null
          throw error
        })
    }
    return await this.rootTenantPromise
  }

  private getExistingContext(): TenantContext | null {
    try {
      return (HttpContext.getValue('tenant') as TenantContext | undefined) ?? null
    }
    catch {
      return null
    }
  }
}
