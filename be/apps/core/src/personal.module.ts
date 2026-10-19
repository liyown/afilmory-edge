import { DatabaseModule } from '@core/database/database.module'
import { AuthGuard } from '@core/guards/auth.guard'
import { PlaceholderTenantGuard } from '@core/guards/placeholder-tenant.guard'
import { RolesGuard } from '@core/guards/roles.guard'
import { TenantResolverInterceptor } from '@core/interceptors/tenant-resolver.interceptor'
import { CorsMiddleware } from '@core/middlewares/cors.middleware'
import { DatabaseContextMiddleware } from '@core/middlewares/database-context.middleware'
import { RequestContextMiddleware } from '@core/middlewares/request-context.middleware'
import { APP_GUARD, APP_INTERCEPTOR, APP_MIDDLEWARE, Module } from '@tsuki-hono/common'

import { AppInitializationModule } from './modules/app/app-initialization.module'
import { AppStateModule } from './modules/app/app-state/app-state.module'
import { BuilderSettingModule } from './modules/configuration/builder-setting/builder-setting.module'
import { SettingModule } from './modules/configuration/setting/setting.module'
import { SiteSettingModule } from './modules/configuration/site-setting/site-setting.module'
import { StorageSettingModule } from './modules/configuration/storage-setting/storage-setting.module'
import { CommentModule } from './modules/content/comment/comment.module'
import { FeedModule } from './modules/content/feed/feed.module'
import { ManifestSyncModule } from './modules/content/manifest-sync/manifest-sync.module'
import { OgModule } from './modules/content/og/og.module'
import { PhotoModule } from './modules/content/photo/photo.module'
import { ReactionModule } from './modules/content/reaction/reaction.module'
import { ShareModule } from './modules/content/share/share.module'
import { InProcessEventModule } from './modules/infrastructure/event/in-process-event.module'
import { HealthModule } from './modules/infrastructure/health/health.module'
import { WellKnownModule } from './modules/infrastructure/well-known/well-known.module'
import { AuthModule } from './modules/platform/auth/auth.module'
import { DashboardModule } from './modules/platform/dashboard/dashboard.module'

/**
 * T0.4: the personal (single-site) module graph.
 *
 * Only the modules needed by a self-hosted gallery are registered. Multi-tenant,
 * billing, super-admin, managed storage and push modules are intentionally
 * excluded from the graph; their files are removed once the kept modules that
 * still import them (auth/photo/comment/settings) are decoupled.
 */
@Module({
  imports: [
    DatabaseModule,
    AppInitializationModule,
    AppStateModule,
    // Redis-backed EventModule → in-process bus (§2.6).
    InProcessEventModule,
    SettingModule,
    SiteSettingModule,
    StorageSettingModule,
    BuilderSettingModule,
    ManifestSyncModule,
    PhotoModule,
    CommentModule,
    ReactionModule,
    FeedModule,
    ShareModule,
    OgModule,
    HealthModule,
    WellKnownModule,
    AuthModule,
    // Admin API + the dashboard SPA itself. Only unused *pages* are trimmed.
    DashboardModule,
  ],
  providers: [
    {
      provide: APP_MIDDLEWARE,
      useClass: RequestContextMiddleware,
    },
    {
      provide: APP_MIDDLEWARE,
      useClass: CorsMiddleware,
    },
    {
      provide: APP_MIDDLEWARE,
      useClass: DatabaseContextMiddleware,
    },
    {
      provide: APP_GUARD,
      useClass: PlaceholderTenantGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantResolverInterceptor,
    },
  ],
})
export class PersonalModule {}
