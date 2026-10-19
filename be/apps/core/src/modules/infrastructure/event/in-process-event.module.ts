import { Module } from '@tsuki-hono/common'

import { EventEmitterService } from './event-emitter.service'

@Module({
  providers: [EventEmitterService],
})
export class InProcessEventModule {}
