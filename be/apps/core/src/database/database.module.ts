import { Module } from '@tsuki-hono/common'

import { DbAccessor, DrizzleProvider } from './database.provider'

@Module({
  providers: [DrizzleProvider, DbAccessor],
})
export class DatabaseModule {}
