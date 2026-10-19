import { DatabaseModule } from '@core/database/database.module'
import { ManifestSyncModule } from '@core/modules/content/manifest-sync/manifest-sync.module'
import { Module } from '@tsuki-hono/common'

import { ExifMetadataService } from './exif-metadata.service'
import { ManifestPublisher } from './manifest-publisher.service'
import { PersonalPhotoController } from './personal-photo.controller'
import { PersonalPhotoService } from './personal-photo.service'
import { S3StorageService } from './s3-storage.service'

@Module({
  imports: [DatabaseModule, ManifestSyncModule],
  controllers: [PersonalPhotoController],
  providers: [PersonalPhotoService, ExifMetadataService, ManifestPublisher, S3StorageService],
})
export class PersonalPhotoModule {}
