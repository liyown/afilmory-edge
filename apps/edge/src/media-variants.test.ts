import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readJpegSize, sourceKeysForThumbnail, THUMBNAIL_PROCESS, THUMBNAIL_SUFFIX } from './media-variants'

/** Minimal JPEG: SOI, an APP0 segment, then a baseline SOF0 with the given size. */
const jpegWithSize = (width: number, height: number) => {
  const app0 = [0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00]
  const sof = [
    0xFF,
    0xC0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xFF,
    height & 0xFF,
    (width >> 8) & 0xFF,
    width & 0xFF,
    0x03,
    ...Array.from({ length: 9 }).fill(0x00),
  ]
  return Uint8Array.from([0xFF, 0xD8, ...app0, ...sof, 0xFF, 0xD9])
}

test('THUMBNAIL_PROCESS uses the OSS underscore argument form', () => {
  // `w=600` made OSS answer `MissingArgument:resize`, which surfaced as a 500
  // on every fallback thumbnail request.
  assert.match(THUMBNAIL_PROCESS, /w_600/)
  assert.doesNotMatch(THUMBNAIL_PROCESS, /w=600/)
})

test('sourceKeysForThumbnail maps a preview key back to candidate originals', () => {
  const keys = sourceKeysForThumbnail(`photos/a/one${THUMBNAIL_SUFFIX}`)
  assert.deepEqual(keys, ['photos/a/one.jpeg', 'photos/a/one.jpg', 'photos/a/one.png', 'photos/a/one.webp'])
})

test('sourceKeysForThumbnail ignores keys that are not previews', () => {
  assert.deepEqual(sourceKeysForThumbnail('photos/a/one.jpeg'), [])
})

test('readJpegSize reads the frame header', () => {
  assert.deepEqual(readJpegSize(jpegWithSize(600, 400)), { width: 600, height: 400 })
})

test('readJpegSize rejects data that is not a JPEG', () => {
  assert.equal(readJpegSize(new Uint8Array([0x89, 0x50, 0x4E, 0x47])), null)
  assert.equal(readJpegSize(new Uint8Array()), null)
})
