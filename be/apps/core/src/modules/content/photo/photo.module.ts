import { BuilderConfigService } from '@core/modules/configuration/builder-config/builder-config.service'
import { SystemSettingModule } from '@core/modules/configuration/system-setting/system-setting.module'
import { Module } from '@tsuki-hono/common'

import { ManifestSyncModule } from '../manifest-sync/manifest-sync.module'
import { PhotoController } from './assets/photo.controller'
import { PhotoAssetService } from './assets/photo-asset.service'
import { PhotoUploadParser } from './assets/photo-upload.parser'
import { PhotoUploadLimitInterceptor } from './assets/photo-upload-limit.interceptor'
import { PhotoBuilderService } from './builder/photo-builder.service'
import { PhotoStorageService } from './storage/photo-storage.service'

@Module({
  imports: [SystemSettingModule, ManifestSyncModule],
  controllers: [PhotoController],
  providers: [
    PhotoBuilderService,
    PhotoStorageService,
    PhotoAssetService,
    PhotoUploadLimitInterceptor,
    PhotoUploadParser,
    BuilderConfigService,
  ],
})
export class PhotoModule {}
