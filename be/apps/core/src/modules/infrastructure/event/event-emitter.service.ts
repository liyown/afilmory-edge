import { injectable } from 'tsyringe'

import type { EventHandler, EventName, EventPayload } from './events'

/**
 * Dispatches events to listeners in the same Worker isolate. A single-site
 * deployment has no second process to fan out to, so no pub/sub transport is
 * involved.
 */
@injectable()
export class EventEmitterService {
  private readonly listeners = new Map<EventName, Set<EventHandler>>()

  async emit<T extends EventName>(event: T, payload: EventPayload<T>): Promise<void> {
    const handlers = this.listeners.get(event)
    if (!handlers) {
      return
    }

    await Promise.all(Array.from(handlers, handler => handler(payload)))
  }

  on<T extends EventName>(event: T, handler: EventHandler<EventPayload<T>>): void {
    let handlers = this.listeners.get(event)
    if (!handlers) {
      handlers = new Set()
      this.listeners.set(event, handlers)
    }
    handlers.add(handler as EventHandler)
  }

  off<T extends EventName>(event: T, handler: EventHandler<EventPayload<T>>): void {
    this.listeners.get(event)?.delete(handler as EventHandler)
  }
}
