import assert from 'node:assert/strict'

import { it } from 'vitest'

import type { WallLayoutOptions, WallPhotoInput } from './wall-layout'
import { createWallLayout, sliceVisibleItems } from './wall-layout'

const OPTIONS: WallLayoutOptions = {
  contentWidth: 1600,
  maxRowHeight: 300,
  minRowHeight: 140,
  gutter: 44,
  rowGap: 64,
  frame: { side: 18, top: 18, bottom: 58 },
  maxRotation: 2.4,
  maxOffset: 14,
  topPadding: 96,
  bottomPadding: 120,
}

const photos = (count: number): WallPhotoInput[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `photo-${index}`,
    width: index % 3 === 0 ? 4000 : 3000,
    height: index % 3 === 0 ? 6000 : 2000,
  }))

const rowCounts = (layout: ReturnType<typeof createWallLayout>) =>
  layout.rows.map((row) => row.endIndex - row.startIndex + 1)

it('createWallLayout is deterministic for the same input', () => {
  const input = photos(24)
  assert.deepEqual(createWallLayout(input, OPTIONS), createWallLayout(input, OPTIONS))
})

it('createWallLayout places every photo exactly once in order', () => {
  const layout = createWallLayout(photos(40), OPTIONS)
  assert.equal(layout.items.length, 40)
  assert.deepEqual(
    layout.items.map((item) => item.id),
    photos(40).map((photo) => photo.id),
  )
  assert.deepEqual(
    layout.items.map((item) => item.index),
    Array.from({ length: 40 }, (_, index) => index),
  )
})

it('createWallLayout keeps every row horizontal', () => {
  const layout = createWallLayout(photos(40), OPTIONS)

  for (const row of layout.rows) {
    const rowItems = layout.items.slice(row.startIndex, row.endIndex + 1)
    const byX = [...rowItems].sort((a, b) => a.x - b.x)
    for (let index = 1; index < byX.length; index++) {
      assert.ok(byX[index].x >= byX[index - 1].x + byX[index - 1].width, 'frames in a row must not overlap')
    }
    // Same row ⇒ roughly the same vertical band.
    const tops = rowItems.map((item) => item.y)
    assert.ok(Math.max(...tops) - Math.min(...tops) <= OPTIONS.maxOffset * 2 + 1)
  }
})

it('createWallLayout makes rows wider towards the middle, like a circle', () => {
  const layout = createWallLayout(photos(60), OPTIONS)
  const counts = rowCounts(layout)
  const widest = Math.max(...counts)
  const widestIndex = counts.indexOf(widest)

  assert.ok(counts[0] < widest, 'the top row must be narrower than the middle')
  assert.ok(counts.at(-1)! < widest, 'the bottom row must be narrower than the middle')

  // Counts rise towards the middle and fall away from it.
  for (let index = 1; index <= widestIndex; index++) {
    assert.ok(counts[index] >= counts[index - 1])
  }
  for (let index = widestIndex + 1; index < counts.length; index++) {
    assert.ok(counts[index] <= counts[index - 1])
  }
})

it('createWallLayout caps the widest row above the narrowest by a sane ratio', () => {
  const layout = createWallLayout(photos(60), OPTIONS)
  const counts = rowCounts(layout)
  assert.ok(Math.max(...counts) >= 4)
  assert.ok(Math.min(...counts) >= 1)
})

it('createWallLayout keeps rows in order without vertical overlap', () => {
  const layout = createWallLayout(photos(60), OPTIONS)
  assert.ok(layout.rows.length >= 3)

  for (let index = 1; index < layout.rows.length; index++) {
    assert.ok(layout.rows[index].top > layout.rows[index - 1].top)
    assert.ok(layout.rows[index].top >= layout.rows[index - 1].bottom)
  }
})

it('createWallLayout centers every row horizontally', () => {
  const layout = createWallLayout(photos(40), OPTIONS)

  for (const row of layout.rows) {
    const rowItems = layout.items.slice(row.startIndex, row.endIndex + 1)
    const left = Math.min(...rowItems.map((item) => item.x))
    const right = Math.max(...rowItems.map((item) => item.x + item.width))
    const leftGap = left
    const rightGap = layout.width - right
    assert.ok(Math.abs(leftGap - rightGap) < 1, 'rows should be horizontally centred')
  }
})

it('createWallLayout keeps rotations within the configured maximum', () => {
  const layout = createWallLayout(photos(30), OPTIONS)
  for (const item of layout.items) {
    assert.ok(Math.abs(item.rotation) <= OPTIONS.maxRotation + 0.01)
    assert.ok(item.photoWidth > 0 && item.photoHeight > 0)
  }
})

it('createWallLayout handles small and empty galleries', () => {
  const empty = createWallLayout([], OPTIONS)
  assert.deepEqual(empty.items, [])
  assert.deepEqual(empty.rows, [])
  assert.equal(empty.height, 0)

  for (const count of [1, 2, 3, 5]) {
    const layout = createWallLayout(photos(count), OPTIONS)
    assert.equal(layout.items.length, count)
  }
})

it('sliceVisibleItems keeps only the rows intersecting the viewport', () => {
  const layout = createWallLayout(photos(60), OPTIONS)
  const row = layout.rows[2]
  const visible = sliceVisibleItems(layout, {
    left: 0,
    top: row.top + 1,
    width: layout.width,
    height: Math.max(1, row.bottom - row.top - 2),
  })

  assert.ok(visible.length > 0)
  assert.ok(visible.every((item) => item.row === 2))
})

it('sliceVisibleItems ignores the horizontal position of the viewport', () => {
  const layout = createWallLayout(photos(40), OPTIONS)
  const top = 0
  const height = layout.height

  const leftEdge = sliceVisibleItems(layout, { left: -4000, top, width: 400, height })
  const rightEdge = sliceVisibleItems(layout, { left: layout.width + 4000, top, width: 400, height })
  assert.equal(leftEdge.length, rightEdge.length)
  assert.equal(leftEdge.length, layout.items.length)
})

it('sliceVisibleItems respects the culling margin', () => {
  const layout = createWallLayout(photos(40), OPTIONS)
  const row = layout.rows[3]
  const gapAbove = { left: 0, top: 0, width: layout.width, height: Math.max(1, row.top - 4) }

  const strict = sliceVisibleItems(layout, gapAbove)
  const padded = sliceVisibleItems(layout, { ...gapAbove, margin: 400 })
  assert.ok(padded.length > strict.length)
})
