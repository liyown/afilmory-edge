import assert from 'node:assert/strict'

import { it } from 'vitest'

import type { WallLayoutOptions, WallPhotoInput } from './wall-layout'
import { createWallLayout, findVisibleRowRange, sliceVisibleItems } from './wall-layout'

const OPTIONS: WallLayoutOptions = {
  contentWidth: 1600,
  targetRowHeight: 300,
  minRowHeight: 200,
  maxRowHeight: 380,
  gutter: 56,
  rowGap: 72,
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

it('createWallLayout is deterministic for the same input', () => {
  const input = photos(24)
  assert.deepEqual(createWallLayout(input, OPTIONS), createWallLayout(input, OPTIONS))
})

it('createWallLayout places every photo exactly once in reading order', () => {
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

it('createWallLayout keeps rows ordered top to bottom without vertical overlap', () => {
  const layout = createWallLayout(photos(60), OPTIONS)
  assert.ok(layout.rows.length > 1)

  for (let index = 1; index < layout.rows.length; index++) {
    assert.ok(layout.rows[index].top > layout.rows[index - 1].top)
    assert.ok(layout.rows[index].top >= layout.rows[index - 1].bottom)
  }
})

it('createWallLayout never overlaps two frames inside a row', () => {
  const layout = createWallLayout(photos(50), OPTIONS)

  for (const row of layout.rows) {
    const rowItems = layout.items.filter((item) => item.row === row.index)
    const byX = [...rowItems].sort((a, b) => a.x - b.x)

    for (let index = 1; index < byX.length; index++) {
      const previous = byX[index - 1]
      assert.ok(byX[index].x >= previous.x + previous.width, 'frames in a row must not overlap')
    }
  }
})

it('createWallLayout keeps rotations within the configured maximum', () => {
  const layout = createWallLayout(photos(30), OPTIONS)
  for (const item of layout.items) {
    assert.ok(Math.abs(item.rotation) <= OPTIONS.maxRotation + 0.01)
    assert.ok(item.photoWidth > 0 && item.photoHeight > 0)
  }
})

it('createWallLayout centers a short row inside the wall width', () => {
  const layout = createWallLayout(photos(2), OPTIONS)
  const row = layout.items.slice(0, 2)
  assert.ok(row[0].x > 0, 'a short row should not be glued to the left edge')
})

it('createWallLayout handles an empty gallery', () => {
  const layout = createWallLayout([], OPTIONS)
  assert.deepEqual(layout.items, [])
  assert.deepEqual(layout.rows, [])
  assert.equal(layout.height, 0)
})

it('findVisibleRowRange returns only rows intersecting the viewport', () => {
  const layout = createWallLayout(photos(60), OPTIONS)
  const row = layout.rows[3]
  const range = findVisibleRowRange(layout.rows, row.top + 1, row.top + 2)

  assert.deepEqual(range, { first: 3, last: 3 })
  assert.ok(sliceVisibleItems(layout, range!).length > 0)
  assert.ok(sliceVisibleItems(layout, range!).every((item) => item.row === 3))
})

it('findVisibleRowRange includes partially visible rows at both edges', () => {
  const layout = createWallLayout(photos(60), OPTIONS)
  const first = layout.rows[2]
  const last = layout.rows[5]
  const range = findVisibleRowRange(layout.rows, first.bottom - 10, last.top + 10)

  assert.deepEqual(range, { first: 2, last: 5 })
  assert.equal(
    sliceVisibleItems(layout, range!).length,
    layout.items.filter((item) => item.row >= 2 && item.row <= 5).length,
  )
})

it('findVisibleRowRange returns null when the viewport is above or below the wall', () => {
  const layout = createWallLayout(photos(20), OPTIONS)
  assert.equal(findVisibleRowRange(layout.rows, -800, -400), null)
  assert.equal(findVisibleRowRange(layout.rows, layout.height + 10, layout.height + 400), null)
  assert.equal(findVisibleRowRange([], 0, 100), null)
})
