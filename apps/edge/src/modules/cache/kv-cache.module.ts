import { Module } from '@tsuki-hono/common'

import { CacheService } from './kv-cache.service'

@Module({
  providers: [CacheService],
})
export class CacheModule {}
