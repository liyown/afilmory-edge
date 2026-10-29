import assert from 'node:assert/strict'

import { it } from 'vitest'

import { hitTest, intersects, pickItems, toCanvasPoint, visibleRect } from './wall-camera'
import type { WallLayoutOptions, WallPhotoInput } from './wall-layout'
import { createWallLayout } from './wall-layout'

const OPTIONS: WallLayoutOptions = {
  contentWidth: 1600,
  maxRowHeight: 300,
  minRowHeight: 140,
  gutter: 44,
  rowGap: 64,
  frame: { side: 18, top: 18, bottom: 58 },
  maxRotation: 0,
  maxOffset: 0,
  topPadding: 96,
  bottomPadding: 120,
}

const photos = (count: number): WallPhotoInput[] =>
  Array.from({ length: count }, (_, index) => ({ id: `p-${index}`, width: 3000, height: 2000 }))

it('visibleRect maps the camera back to canvas space', () => {
  const camera = { scale: 0.5, positionX: -100, positionY: -50 }
  const rect = visibleRect(camera, 800, 600)

  assert.equal(rect.left, 200)
  assert.equal(rect.top, 100)
  assert.equal(rect.right, 200 + 1600)
  assert.equal(rect.bottom, 100 + 1200)
})

it('visibleRect widens by the culling margin', () => {
  const camera = { scale: 1, positionX: 0, positionY: 0 }
  const tight = visibleRect(camera, 400, 300)
  const padded = visibleRect(camera, 400, 300, 100)

  assert.equal(padded.left, tight.left - 100)
  assert.equal(padded.right, tight.right + 100)
  assert.equal(padded.top, tight.top - 100)
  assert.equal(padded.bottom, tight.bottom + 100)
})

it('intersects culls frames outside the viewport', () => {
  const layout = createWallLayout(photos(12), OPTIONS)
  const item = layout.items[0]

  const inside = { left: item.x - 1, top: item.y - 1, right: item.x + item.width + 1, bottom: item.y + item.height + 1 }
  const outside = { left: item.x + item.width + 100, top: item.y, right: item.x + 5000, bottom: item.y + item.height }

  assert.equal(intersects(item, inside), true)
  assert.equal(intersects(item, outside), false)
})

it('pickItems returns only frames intersecting the rect', () => {
  const layout = createWallLayout(photos(16), OPTIONS)
  const first = layout.items[0]
  const rect = {
    left: first.x,
    top: first.y,
    right: first.x + first.width,
    bottom: first.y + first.height,
  }

  const picked = pickItems(layout, rect)
  assert.ok(picked.length > 0)
  assert.ok(picked.length < layout.items.length)
  assert.ok(picked.every((item) => item.id === first.id || intersects(item, rect)))
})

it('hitTest finds the frame under a canvas point', () => {
  const layout = createWallLayout(photos(9), OPTIONS)
  const item = layout.items[3]

  const hit = hitTest(layout, item.x + item.width / 2, item.y + item.height / 2, 0.1)
  assert.equal(hit?.id, item.id)
})

it('hitTest returns null on empty canvas space', () => {
  const layout = createWallLayout(photos(6), OPTIONS)
  assert.equal(hitTest(layout, -5000, -5000, 0.1), null)
})

it('toCanvasPoint inverts the camera transform', () => {
  const camera = { scale: 0.5, positionX: 40, positionY: -20 }
  const point = toCanvasPoint(camera, 240, 180)

  assert.equal(point.x, (240 - 40) / 0.5)
  assert.equal(point.y, (180 + 20) / 0.5)
})
