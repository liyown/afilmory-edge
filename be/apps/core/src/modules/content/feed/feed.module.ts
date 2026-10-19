import { SiteSettingModule } from '@core/modules/configuration/site-setting/site-setting.module'
import { CacheModule } from '@core/modules/infrastructure/cache/cache.module'
import { Module } from '@tsuki-hono/common'

import { ManifestModule } from '../manifest/manifest.module'
import { FeedController } from './feed.controller'
import { FeedService } from './feed.service'
import { SitemapController } from './sitemap.controller'
import { SitemapService } from './sitemap.service'

@Module({
  imports: [CacheModule, SiteSettingModule, ManifestModule],
  controllers: [FeedController, SitemapController],
  providers: [FeedService, SitemapService],
})
export class FeedModule {}
