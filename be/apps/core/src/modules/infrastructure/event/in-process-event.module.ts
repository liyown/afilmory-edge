import { EventModule } from '@tsuki-hono/event-emitter'

// The upstream EventModule requires Redis pub/sub. A single-site deployment is
// one Worker process, so events only need to reach local listeners — the
// `EventEmitterService` already dispatches locally; the Redis client is only
// used to fan out to other instances. This stub satisfies the client shape so
// `start()` succeeds without opening a socket (workerd has no TCP).
const noopRedisClient = {
  publish: async () => 0,
  duplicate: () => noopRedisClient,
  subscribe: async () => undefined,
  unsubscribe: async () => undefined,
  quit: async () => undefined,
  on: () => undefined,
}

export const InProcessEventModule = EventModule.forRootAsync({
  useFactory: () => ({
    redisClient: noopRedisClient,
  }),
})
