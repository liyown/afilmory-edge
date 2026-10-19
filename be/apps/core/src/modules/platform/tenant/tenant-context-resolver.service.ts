import { logger } from '@core/helpers/logger.helper'
import { AppStateService } from '@core/modules/app/app-state/app-state.service'
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
export class TenantContextResolver {
  private readonly log = logger.extend('TenantResolver')
  private rootTenantPromise: Promise<TenantContext> | null = null

  constructor(
    private readonly tenantService: TenantService,
    private readonly appState: AppStateService,
  ) {}

  async resolve(_context: Context, options: TenantResolutionOptions = {}): Promise<TenantContext | null> {
    const existing = this.getExistingContext()
    if (existing) {
      return existing
    }

    if (!options.skipInitializationCheck) {
      const initialized = await this.appState.isInitialized()
      if (!initialized) {
        this.log.info('Application not initialized yet, skip tenant resolution')
        return null
      }
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
