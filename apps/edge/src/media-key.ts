export const PUBLIC_MEDIA_PREFIX = 'photos/'

/**
 * The photos bucket also holds D1 backups under `backups/d1/`. Only user
 * photos may be served over HTTP; every other prefix stays private.
 */
export function isPublicMediaKey(key: string): boolean {
  return key.startsWith(PUBLIC_MEDIA_PREFIX) && !key.split('/').includes('..')
}

export function decodeMediaKey(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}
