import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSearchText, mergeDisplayTags, normalizeTags, parseVisionOutput, thumbnailKeyFor } from './photo-ai-utils'

test('thumbnailKeyFor follows the gallery convention', () => {
  assert.equal(thumbnailKeyFor('photos/a/one.JPG'), 'photos/a/one-thumb.jpg')
  assert.equal(thumbnailKeyFor('photos/a/one'), 'photos/a/one-thumb.jpg')
})

test('normalizeTags lowercases, dedupes, filters generic words and caps the list', () => {
  const tags = normalizeTags([
    'Sunset',
    ' sunset ',
    'Photo',
    'Beach',
    'a',
    ...Array.from({ length: 20 }, (_, index) => `tag-${index}`),
  ])
  assert.deepEqual(tags.slice(0, 3), ['sunset', 'beach', 'tag-0'])
  assert.equal(tags.length, 12)
})

test('parseVisionOutput accepts fenced JSON and surrounding prose', () => {
  const parsed = parseVisionOutput({
    answer: 'Here is the result:\n```json\n{"caption":"A cat on a sofa","tags":["cat","sofa"]}\n```',
  })
  assert.deepEqual(parsed, { caption: 'A cat on a sofa', tags: ['cat', 'sofa'] })
})

test('parseVisionOutput falls back to caption text when JSON is malformed', () => {
  const parsed = parseVisionOutput({ answer: 'A quiet street at night' })
  assert.deepEqual(parsed, { caption: 'A quiet street at night', tags: [] })
})

test('parseVisionOutput returns null for empty output', () => {
  assert.equal(parseVisionOutput({ answer: '   ' }), null)
})

test('mergeDisplayTags preserves manual tags and appends new AI tags', () => {
  assert.deepEqual(mergeDisplayTags(['Travel', 'Sunset'], ['sunset', 'beach']), ['Travel', 'Sunset', 'beach'])
})

test('buildSearchText includes title, caption, tags and camera', () => {
  const text = buildSearchText(
    {
      version: 'v10',
      data: {
        title: 'Harbor',
        tags: ['manual'],
        exif: { Make: 'Sony', Model: 'A7' },
        location: { city: 'Xiamen', country: 'China' },
      },
    } as never,
    'A boat at sunset',
    ['sunset', 'boat'],
  )
  assert.match(text, /Harbor/)
  assert.match(text, /A boat at sunset/)
  assert.match(text, /sunset/)
  assert.match(text, /Sony A7/)
  assert.match(text, /Xiamen China/)
})
