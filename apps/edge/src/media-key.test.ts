import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { decodeMediaKey, isPublicMediaKey } from './media-key'

describe('public media keys', () => {
  it('allows keys under the photos prefix', () => {
    assert.equal(isPublicMediaKey('photos/2026/photo.jpg'), true)
    assert.equal(isPublicMediaKey('photos/photo-thumb.jpg'), true)
  })

  it('rejects backups and other prefixes', () => {
    assert.equal(isPublicMediaKey('backups/d1/2026-10-19T02-30-00-000Z.json.gz'), false)
    assert.equal(isPublicMediaKey('og/home.png'), false)
    assert.equal(isPublicMediaKey('photos'), false)
    assert.equal(isPublicMediaKey('photos/../backups/d1/2026-10-19.json.gz'), false)
  })

  it('rejects malformed percent escapes', () => {
    assert.equal(decodeMediaKey('photos/%E0%A4%A'), null)
    assert.equal(decodeMediaKey('photos/a.jpg'), 'photos/a.jpg')
  })
})
