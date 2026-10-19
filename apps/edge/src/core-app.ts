import 'reflect-metadata'

import { DatabaseModule } from '@core/database/database.module'
import { AllExceptionsFilter } from '@core/filters/all-exceptions.filter'
import { AuthGuard } from '@core/guards/auth.guard'
import { PlaceholderTenantGuard } from '@core/guards/placeholder-tenant.guard'
import { RolesGuard } from '@core/guards/roles.guard'
import { ResponseTransformInterceptor } from '@core/interceptors/response-transform.interceptor'
import { TenantResolverInterceptor } from '@core/interceptors/tenant-resolver.interceptor'
import { CorsMiddleware } from '@core/middlewares/cors.middleware'
import { DatabaseContextMiddleware } from '@core/middlewares/database-context.middleware'
import { RequestContextMiddleware } from '@core/middlewares/request-context.middleware'
import { AppStateModule } from '@core/modules/app/app-state/app-state.module'
import { SettingModule } from '@core/modules/configuration/setting/setting.module'
import { SystemSettingModule } from '@core/modules/configuration/system-setting/system-setting.module'
import { InProcessEventModule } from '@core/modules/infrastructure/event/in-process-event.module'
import { AuthModule } from '@core/modules/platform/auth/auth.module'
import { TenantModule } from '@core/modules/platform/tenant/tenant.module'
import { APP_GUARD, APP_INTERCEPTOR, APP_MIDDLEWARE, createZodValidationPipe, Module } from '@tsuki-hono/common'
import type { HonoHttpApplication } from '@tsuki-hono/core'
import { createApplication } from '@tsuki-hono/core'

/**
 * T3.1: the first slice of the core graph that runs in the Worker. It covers
 * authentication only; settings/photo/feed modules still depend on Redis or
 * Node-only infrastructure and are mounted in later tasks.
 */
@Module({
  imports: [
    DatabaseModule,
    InProcessEventModule,
    AppStateModule,
    SettingModule,
    SystemSettingModule,
    TenantModule,
    AuthModule,
  ],
  providers: [
    { provide: APP_MIDDLEWARE, useClass: RequestContextMiddleware },
    { provide: APP_MIDDLEWARE, useClass: CorsMiddleware },
    { provide: APP_MIDDLEWARE, useClass: DatabaseContextMiddleware },
    { provide: APP_GUARD, useClass: PlaceholderTenantGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantResolverInterceptor },
  ],
})
export class EdgeCoreModule {}

const GlobalValidationPipe = createZodValidationPipe({
  transform: true,
  whitelist: true,
  errorHttpStatusCode: 422,
  forbidUnknownValues: true,
  stopAtFirstError: true,
})

let applicationPromise: Promise<HonoHttpApplication> | undefined

export function getCoreApp(): Promise<HonoHttpApplication> {
  if (!applicationPromise) {
    applicationPromise = createApplication(EdgeCoreModule, { globalPrefix: '/api' }).then((app) => {
      app.useGlobalFilters(new AllExceptionsFilter())
      app.useGlobalInterceptors(new ResponseTransformInterceptor())
      app.useGlobalPipes(new GlobalValidationPipe())
      return app
    })
  }
  return applicationPromise
}
