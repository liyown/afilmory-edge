import { applyDecorators } from '@tsuki-hono/common'

export const AUTH_REQUIRED_METADATA = Symbol.for('core.auth.required')
export const PLATFORM_ROLES_METADATA = Symbol.for('core.auth.platform_roles')

export type PlatformRole = 'user' | 'superadmin'

function defineMetadataDecorator<T>(key: symbol, value: T): MethodDecorator & ClassDecorator {
  return applyDecorators((target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const targetForMetadata = descriptor?.value && typeof descriptor.value === 'function' ? descriptor.value : target
    Reflect.defineMetadata(key, value, targetForMetadata)
  })
}

export function RequireAuth(): MethodDecorator & ClassDecorator {
  return defineMetadataDecorator(AUTH_REQUIRED_METADATA, true)
}

export function PlatformRoles(...roles: PlatformRole[]): MethodDecorator & ClassDecorator {
  return defineMetadataDecorator(PLATFORM_ROLES_METADATA, roles)
}

export function isAuthRequired(target: object): boolean {
  return Reflect.getMetadata(AUTH_REQUIRED_METADATA, target) === true
}

export function getPlatformRoles(target: object): PlatformRole[] {
  return (Reflect.getMetadata(PLATFORM_ROLES_METADATA, target) ?? []) as PlatformRole[]
}
