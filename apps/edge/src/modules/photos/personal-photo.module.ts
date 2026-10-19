import { DatabaseModule } from '@core/database/database.module'
import { ManifestSyncModule } from '@core/modules/content/manifest-sync/manifest-sync.module'
import { Module } from '@tsuki-hono/common'

import { ExifMetadataService } from './exif-metadata.service'
import { ManifestPublisher } from './manifest-publisher.service'
import { PersonalPhotoController } from './personal-photo.controller'
import { PersonalPhotoService } from './personal-photo.service'
import { PhotoAiIndexer } from './photo-ai-indexer'
import { PhotoStorageService } from './photo-storage.service'

@Module({
  imports: [DatabaseModule, ManifestSyncModule],
  controllers: [PersonalPhotoController],
  providers: [PersonalPhotoService, ExifMetadataService, ManifestPublisher, PhotoStorageService, PhotoAiIndexer],
})
export class PersonalPhotoModule {}
