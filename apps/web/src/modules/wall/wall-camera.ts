import type { WallLayout, WallLayoutItem } from './wall-layout'

export interface WallCamera {
  /** Canvas-space units per CSS pixel. */
  scale: number
  positionX: number
  positionY: number
}

export interface WallVisibleRect {
  left: number
  top: number
  right: number
  bottom: number
}

const EPSILON = 0.5

/**
 * The rectangle of canvas space currently on screen. Everything the renderer
 * touches has to intersect this, which keeps both draw calls and image decodes
 * proportional to what is actually visible.
 */
export const visibleRect = (
  camera: WallCamera,
  viewportWidth: number,
  viewportHeight: number,
  margin = 0,
): WallVisibleRect => {
  const scale = camera.scale || 1
  return {
    left: -camera.positionX / scale - margin,
    top: -camera.positionY / scale - margin,
    right: (viewportWidth - camera.positionX) / scale + margin,
    bottom: (viewportHeight - camera.positionY) / scale + margin,
  }
}

export const intersects = (item: WallLayoutItem, rect: WallVisibleRect) =>
  item.x + item.width >= rect.left - EPSILON &&
  item.x <= rect.right + EPSILON &&
  item.y + item.height >= rect.top - EPSILON &&
  item.y <= rect.bottom + EPSILON

export const pickItems = (layout: WallLayout, rect: WallVisibleRect) =>
  layout.items.filter((item) => intersects(item, rect))

/**
 * Point-in-frame test in canvas space, accounting for the frame's rotation.
 * Rotation is applied around a pivot inside the frame, so the inverse
 * transform has to use the same pivot.
 */
export const hitTest = (
  layout: WallLayout,
  canvasX: number,
  canvasY: number,
  pivotRatio: number,
): WallLayoutItem | null => {
  for (let index = layout.items.length - 1; index >= 0; index--) {
    const item = layout.items[index]
    if (
      canvasX < item.x - EPSILON ||
      canvasX > item.x + item.width + EPSILON ||
      canvasY < item.y - EPSILON ||
      canvasY > item.y + item.height + EPSILON
    ) {
      continue
    }

    if (!item.rotation) {
      return item
    }

    const pivotX = item.x + item.width / 2
    const pivotY = item.y + item.height * pivotRatio
    const angle = (-item.rotation * Math.PI) / 180
    const dx = canvasX - pivotX
    const dy = canvasY - pivotY
    const localX = pivotX + dx * Math.cos(angle) - dy * Math.sin(angle)
    const localY = pivotY + dx * Math.sin(angle) + dy * Math.cos(angle)

    const inside =
      localX >= item.x && localX <= item.x + item.width && localY >= item.y && localY <= item.y + item.height

    if (inside) {
      return item
    }
  }

  return null
}

/** Screen (CSS px) → canvas space. */
export const toCanvasPoint = (camera: WallCamera, screenX: number, screenY: number) => ({
  x: (screenX - camera.positionX) / (camera.scale || 1),
  y: (screenY - camera.positionY) / (camera.scale || 1),
})

/**
 * Clamps a pan axis so the wall never leaves the screen.
 *
 * - Wall larger than the viewport: the wall edge may not move past the viewport
 *   edge, plus `margin` of slack so it feels rubbery rather than hard-stopped.
 * - Wall smaller than the viewport: it is kept fully on screen and centred when
 *   there is room, again with `margin` of slack.
 */
export const clampPanAxis = (position: number, wallSize: number, viewportSize: number, margin: number) => {
  // The wall is narrower than the viewport, so there is no travel at all: keep
  // it centred instead of pinning it to one edge.
  if (wallSize + margin * 2 <= viewportSize) {
    return (viewportSize - wallSize) / 2
  }

  // The wall may be nudged past the viewport edge, but never so far that most
  // of it disappears: everything past `margin` is pulled back.
  const min = viewportSize - wallSize - margin
  const max = margin
  return Math.min(max, Math.max(min, position))
}

/**
 * A drag still ends with a native `click`. Compare where the pointer went down
 * with where the click landed: beyond a few pixels it was a pan, not a tap.
 */
export const isTap = (press: { x: number; y: number } | null, click: { x: number; y: number }, slop = 6) => {
  if (!press) {
    return true
  }
  return Math.hypot(click.x - press.x, click.y - press.y) <= slop
}
