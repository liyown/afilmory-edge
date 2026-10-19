import 'reflect-metadata'

import { container, injectable } from 'tsyringe'

@injectable()
class Suffix {
  readonly value = '!'
}

@injectable()
class Greeter {
  // No explicit @inject(): resolution relies purely on emitted design:paramtypes.
  constructor(private readonly suffix: Suffix) {}

  greet(name: string) {
    return `hello ${name}${this.suffix.value}`
  }
}

export function runDecoratorSpike(): { ok: boolean, message: string, metadata: unknown } {
  const paramTypes = Reflect.getMetadata('design:paramtypes', Greeter) as unknown[] | undefined

  try {
    const greeter = container.resolve(Greeter)
    return {
      ok: true,
      message: greeter.greet('tsyringe'),
      metadata: paramTypes?.map(type => (type as { name?: string })?.name ?? String(type)),
    }
  }
  catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      metadata: paramTypes?.map(type => (type as { name?: string })?.name ?? String(type)),
    }
  }
}
