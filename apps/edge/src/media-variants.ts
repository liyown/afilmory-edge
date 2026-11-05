/**
 * Preview variants shared by the media route and the storage maintenance job.
 *
 * Uploads normally store `<original base>-thumb.jpg` next to the original.
 * When that object is missing the media route can ask OSS to render the same
 * 600px JPEG from the original, so every consumer of `thumbnailUrl` keeps
 * working without a backfill.
 */
export const THUMBNAIL_SUFFIX = '-thumb.jpg'
// OSS spells resize arguments as `w_600`, not `w=600`; the latter is rejected
// with `MissingArgument:resize`.
export const THUMBNAIL_PROCESS = 'image/resize,w_600/format,jpg/quality,q_85'

const SOURCE_EXTENSIONS = ['.jpeg', '.jpg', '.png', '.webp']

/** Original keys that may correspond to a thumbnail key. */
export const sourceKeysForThumbnail = (key: string): string[] => {
  if (!key.endsWith(THUMBNAIL_SUFFIX)) {
    return []
  }
  const base = key.slice(0, -THUMBNAIL_SUFFIX.length)
  return SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`)
}

/**
 * Width/height from the first JPEG SOF segment. Used to tell a real preview
 * from the original: if the backend ignores `x-oss-process`, the GET returns
 * the full-size frame and must not be stored as a thumbnail.
 */
export const readJpegSize = (bytes: Uint8Array): { width: number; height: number } | null => {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
    return null
  }

  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xFF) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    offset += 2
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
      continue
    }
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2) {
      return null
    }
    const isFrameHeader = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC
    if (isFrameHeader) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4]
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6]
      return { width, height }
    }
    offset += length
  }
  return null
}
