import { SiteSettingModule } from '@core/modules/configuration/site-setting/site-setting.module'
import { Module } from '@tsuki-hono/common'

import { ManifestModule } from '../manifest/manifest.module'
import { ShareController } from './share.controller'
import { ShareService } from './share.service'

@Module({
  imports: [SiteSettingModule, ManifestModule],
  controllers: [ShareController],
  providers: [ShareService],
})
export class ShareModule {}
