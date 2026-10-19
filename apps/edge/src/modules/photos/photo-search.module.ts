import { DatabaseModule } from '@core/database/database.module'
import { Module } from '@tsuki-hono/common'

import { PhotoSearchController } from './photo-search.controller'
import { PhotoSearchService } from './photo-search.service'

@Module({
  imports: [DatabaseModule],
  controllers: [PhotoSearchController],
  providers: [PhotoSearchService],
})
export class PhotoSearchModule {}
