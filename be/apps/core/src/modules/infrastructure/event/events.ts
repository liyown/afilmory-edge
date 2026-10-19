export interface Events {}

export type EventName = keyof Events | (string & {})

export type EventPayload<T extends EventName> = T extends keyof Events ? Events[T] : unknown

export type EventHandler<T = unknown> = (payload: T) => Promise<void> | void
