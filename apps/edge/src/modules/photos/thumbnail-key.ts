/**
 * Storage key of the 600px preview that sits next to an original:
 * `photos/name-id.jpeg` → `photos/name-id-thumb.jpg`.
 *
 * Shared by the upload pipeline, the AI indexer, and the storage cleanup job:
 * the cleanup job must treat thumbnails as referenced, otherwise it deletes
 * every one of them 24h after upload.
 */
export function thumbnailKeyFor(storageKey: string): string {
  const dotIndex = storageKey.lastIndexOf('.')
  const base = dotIndex > 0 ? storageKey.slice(0, dotIndex) : storageKey
  return `${base}-thumb.jpg`
}
