import { Module } from '@tsuki-hono/common'

import { CacheService } from './cache.service'

@Module({
  providers: [CacheService],
})
export class CacheModule {}
