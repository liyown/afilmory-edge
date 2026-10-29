export interface WallPhotoInput {
  id: string
  width: number
  height: number
}

export interface WallFrameInsets {
  side: number
  top: number
  bottom: number
}

export interface WallLayoutOptions {
  contentWidth: number
  targetRowHeight: number
  minRowHeight: number
  maxRowHeight: number
  gutter: number
  rowGap: number
  frame: WallFrameInsets
  maxRotation: number
  maxOffset: number
  topPadding: number
  bottomPadding: number
}

export interface WallLayoutItem {
  id: string
  index: number
  row: number
  x: number
  y: number
  width: number
  height: number
  photoWidth: number
  photoHeight: number
  rotation: number
}

export interface WallLayoutRow {
  index: number
  startIndex: number
  endIndex: number
  top: number
  bottom: number
}

export interface WallLayout {
  items: WallLayoutItem[]
  rows: WallLayoutRow[]
  width: number
  height: number
  topPadding: number
}

export interface WallVisibleRange {
  first: number
  last: number
}

export const WALL_TOP_INSET = 64

const DEFAULT_ASPECT = 4 / 3
const MIN_ASPECT = 0.3
const MAX_ASPECT = 5

const round = (value: number) => Math.round(value * 100) / 100

const resolveAspect = (photo: WallPhotoInput) => {
  if (photo.width > 0 && photo.height > 0) {
    return Math.min(Math.max(photo.width / photo.height, MIN_ASPECT), MAX_ASPECT)
  }
  return DEFAULT_ASPECT
}

const hashString = (value: string) => {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const random01 = (seed: number, salt: number) => {
  let value = (seed + Math.imul(salt, 0x9E3779B1)) | 0
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}

const centeredStart = (contentWidth: number, totalWidth: number) =>
  totalWidth >= contentWidth ? 0 : (contentWidth - totalWidth) / 2

export const createWallLayout = (photos: WallPhotoInput[], options: WallLayoutOptions): WallLayout => {
  const items: WallLayoutItem[] = []
  const rows: WallLayoutRow[] = []

  if (photos.length === 0) {
    return { items, rows, width: options.contentWidth, height: 0, topPadding: options.topPadding }
  }

  const { bottomPadding, contentWidth, frame, gutter, maxOffset, maxRotation, rowGap } = options
  const frameSideWidth = frame.side * 2
  const frameExtraHeight = frame.top + frame.bottom

  let cursorY = options.topPadding
  let index = 0
  let rowIndex = 0

  while (index < photos.length) {
    let count = 0
    let aspectSum = 0
    let photoHeight = options.targetRowHeight

    while (index + count < photos.length) {
      aspectSum += resolveAspect(photos[index + count])
      count += 1
      const availableWidth = contentWidth - count * frameSideWidth - (count - 1) * gutter
      photoHeight = availableWidth / aspectSum
      if (photoHeight <= options.targetRowHeight) {
        break
      }
    }

    photoHeight = Math.min(Math.max(photoHeight, options.minRowHeight), options.maxRowHeight)

    const frameWidths: number[] = []
    for (let offset = 0; offset < count; offset++) {
      frameWidths.push(round(resolveAspect(photos[index + offset]) * photoHeight + frameSideWidth))
    }

    const totalWidth = frameWidths.reduce((sum, width) => sum + width, 0) + gutter * (count - 1)
    const frameHeight = round(photoHeight + frameExtraHeight)

    let cursorX = centeredStart(contentWidth, totalWidth)
    let rowTop = Number.POSITIVE_INFINITY
    let rowBottom = Number.NEGATIVE_INFINITY

    for (let offset = 0; offset < count; offset++) {
      const photo = photos[index + offset]
      const seed = hashString(photo.id)
      const rotation = round((random01(seed, 1) * 2 - 1) * maxRotation)
      const offsetY = round((random01(seed, 2) * 2 - 1) * maxOffset)
      const frameWidth = frameWidths[offset]
      const y = round(cursorY + offsetY)

      items.push({
        id: photo.id,
        index: index + offset,
        row: rowIndex,
        x: round(cursorX),
        y,
        width: frameWidth,
        height: frameHeight,
        photoWidth: round(frameWidth - frameSideWidth),
        photoHeight,
        rotation,
      })

      rowTop = Math.min(rowTop, y)
      rowBottom = Math.max(rowBottom, y + frameHeight)
      cursorX += frameWidth + gutter
    }

    rows.push({
      index: rowIndex,
      startIndex: index,
      endIndex: index + count - 1,
      top: round(rowTop),
      bottom: round(rowBottom),
    })

    cursorY = rowBottom + rowGap
    index += count
    rowIndex += 1
  }

  const lastRow = rows.at(-1)

  return {
    items,
    rows,
    width: contentWidth,
    height: round((lastRow?.bottom ?? 0) + bottomPadding),
    topPadding: options.topPadding,
  }
}

export const findVisibleRowRange = (
  rows: WallLayoutRow[],
  viewportTop: number,
  viewportBottom: number,
): WallVisibleRange | null => {
  if (rows.length === 0 || viewportBottom < viewportTop) {
    return null
  }

  let low = 0
  let high = rows.length - 1
  let first = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    if (rows[mid].bottom >= viewportTop) {
      first = mid
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  if (first === -1) {
    return null
  }

  low = first
  high = rows.length - 1
  let last = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    if (rows[mid].top <= viewportBottom) {
      last = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return last === -1 ? null : { first, last }
}

export const sliceVisibleItems = (layout: WallLayout, range: WallVisibleRange) => {
  const firstRow = layout.rows[range.first]
  const lastRow = layout.rows[range.last]

  if (!firstRow || !lastRow) {
    return []
  }

  return layout.items.slice(firstRow.startIndex, lastRow.endIndex + 1)
}
