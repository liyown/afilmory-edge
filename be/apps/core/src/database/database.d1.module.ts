import { Module } from '@tsuki-hono/common'

import { DbAccessor, DrizzleProvider, PgPoolProvider } from './database.d1.provider'

@Module({
  providers: [PgPoolProvider, DrizzleProvider, DbAccessor],
})
export class DatabaseModule {}
