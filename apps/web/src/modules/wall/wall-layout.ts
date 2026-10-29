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
  /** Width the rows are laid out in; rows are centred inside it. */
  contentWidth: number
  /** Frame height of the widest row (the middle of the cluster). */
  maxRowHeight: number
  /** Frame height of the narrowest rows (top and bottom of the cluster). */
  minRowHeight: number
  /** Minimum space between neighbouring frames. */
  gutter: number
  /** Minimum space between rows. */
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
  /** Row the item belongs to, 0 = top. */
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
  /** Row index whose width is widest, i.e. the vertical centre of the cluster. */
  centerRow: number
}

export const WALL_TOP_INSET = 64

const DEFAULT_ASPECT = 4 / 3
const MIN_ASPECT = 0.3
const MAX_ASPECT = 5
/** Rows never get narrower than this fraction of the widest row. */
const MIN_ROW_WIDTH_RATIO = 0.12
/** Photos in narrower rows are scaled down so the silhouette reads as a circle. */
const MIN_ROW_PHOTO_RATIO = 0.72

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
  let value = (seed + Math.imul(salt, 2654435761)) | 0
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}

/**
 * Relative half-width of a row, given how far it sits from the vertical centre.
 * `1` at the centre, tapering to `MIN_ROW_WIDTH_RATIO` at the edges, so the
 * stacked rows trace an ellipse instead of a rectangle.
 */
const rowWidthFactor = (row: number, totalRows: number) => {
  if (totalRows <= 1) {
    return 1
  }
  const center = (totalRows - 1) / 2
  const offsetFromCenter = center === 0 ? 0 : Math.abs(row - center) / center
  // Circular arc: r = sqrt(1 - t²). Squaring the offset keeps the belly full
  // and only pinches the outermost rows, which is what reads as "round".
  const profile = Math.sqrt(Math.max(0, 1 - offsetFromCenter ** 2))
  return MIN_ROW_WIDTH_RATIO + (1 - MIN_ROW_WIDTH_RATIO) * profile
}

/** Ring capacity grows with `n`, so total slots are ~3n²; invert for a row count. */
const estimateRowCount = (count: number) => {
  if (count <= 3) {
    return 1
  }
  if (count <= 6) {
    return 3
  }
  if (count <= 12) {
    return 4
  }
  if (count <= 20) {
    return 6
  }
  return Math.min(15, Math.max(6, Math.round(Math.sqrt(count / 0.55))))
}

/** Split `count` photos into `rows` rows following the ellipse profile. */
const planRowCounts = (count: number, rows: number) => {
  const profile = Array.from({ length: rows }, (_, row) => rowWidthFactor(row, rows))
  const weights = profile.map((factor) => factor ** 2.1)
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)

  const counts = weights.map((weight) => Math.max(1, Math.round((count * weight) / weightSum)))

  // Push the rounding drift into the widest rows so the total always matches.
  const widest = () => counts.indexOf(Math.max(...counts))
  let total = counts.reduce((sum, n) => sum + n, 0)
  while (total > count) {
    const target = widest()
    if (counts[target] <= 1) {
      break
    }
    counts[target] -= 1
    total -= 1
  }
  while (total < count) {
    counts[widest()] += 1
    total += 1
  }

  return counts
}

export const createWallLayout = (photos: WallPhotoInput[], options: WallLayoutOptions): WallLayout => {
  const items: WallLayoutItem[] = []
  const rows: WallLayoutRow[] = []

  const { contentWidth, frame, gutter, maxOffset, maxRotation, rowGap } = options

  if (photos.length === 0) {
    return { items, rows, width: contentWidth, height: 0, centerRow: 0 }
  }

  const rowCount = Math.min(estimateRowCount(photos.length), photos.length)
  const rowCounts = planRowCounts(photos.length, rowCount)

  let index = 0
  let cursorY = options.topPadding
  const totalRows = rowCounts.length

  for (let row = 0; row < totalRows; row++) {
    const count = rowCounts[row]
    if (count === 0) {
      continue
    }

    // The ellipse profile sets both how wide this row is *and* how large its
    // photos may be, so every row fills its band and the taper is visible.
    const heightFactor = rowWidthFactor(row, totalRows)
    const rowWidth = contentWidth * heightFactor
    const rowPhotos = photos.slice(index, index + count)

    // Solve for the photo height that makes the row exactly as wide as its band.
    // Frame chrome (side padding, gutters) is fixed, so it comes out first and
    // the remaining width is shared by the photos in proportion to their aspect.
    const availableWidth = rowWidth - count * frame.side * 2 - (count - 1) * gutter
    const aspectSum = rowPhotos.reduce((sum, photo) => sum + resolveAspect(photo), 0)
    const maxPhotoHeight = Math.max(
      options.minRowHeight,
      Math.round(options.maxRowHeight * (MIN_ROW_PHOTO_RATIO + (1 - MIN_ROW_PHOTO_RATIO) * heightFactor)),
    )
    const fittedHeight = Math.floor(availableWidth / Math.max(aspectSum, 0.1))
    const rowPhotoHeight = Math.max(1, Math.min(maxPhotoHeight, fittedHeight))
    // No row may exceed the canvas, whatever the caps above produced.
    const safePhotoHeight = rowPhotoHeight

    const frames = rowPhotos.map((photo) => {
      const width = round(resolveAspect(photo) * safePhotoHeight + frame.side * 2)
      return { photo, width, height: round(safePhotoHeight + frame.top + frame.bottom) }
    })

    const rowFrameWidth = frames.reduce((sum, item) => sum + item.width, 0) + gutter * (count - 1)
    const startX = (contentWidth - rowFrameWidth) / 2

    let cursorX = startX
    let rowTop = Number.POSITIVE_INFINITY
    let rowBottom = Number.NEGATIVE_INFINITY

    for (let offset = 0; offset < frames.length; offset++) {
      const entry = frames[offset]
      const seed = hashString(entry.photo.id)
      const rotation = round((random01(seed, 1) * 2 - 1) * maxRotation)
      const offsetY = round((random01(seed, 2) * 2 - 1) * maxOffset)
      const y = round(cursorY + offsetY)

      items.push({
        id: entry.photo.id,
        index: index + offset,
        row,
        x: round(cursorX),
        y,
        width: entry.width,
        height: entry.height,
        photoWidth: round(entry.width - frame.side * 2),
        photoHeight: round(entry.height - frame.top - frame.bottom),
        rotation,
      })

      rowTop = Math.min(rowTop, y)
      rowBottom = Math.max(rowBottom, y + entry.height)
      cursorX += entry.width + gutter
    }

    rows.push({
      index: row,
      startIndex: index,
      endIndex: index + count - 1,
      top: round(rowTop),
      bottom: round(rowBottom),
    })

    cursorY = rowBottom + rowGap
    index += count
  }

  const lastRow = rows.at(-1)
  const centerRow = rowCounts.indexOf(Math.max(...rowCounts))

  return {
    items,
    rows,
    width: contentWidth,
    height: round((lastRow?.bottom ?? 0) + options.bottomPadding),
    centerRow,
  }
}

export interface WallViewport {
  /** Visible rectangle in canvas coordinates. */
  left: number
  top: number
  width: number
  height: number
  /** Extra canvas-space margin kept mounted around the viewport. */
  margin?: number
}

/**
 * Rows are culled by vertical intersection only, which is enough: a row spans
 * the full canvas width by construction, so the horizontal position of the
 * viewport never changes which rows are visible.
 */
export const sliceVisibleItems = (layout: WallLayout, viewport: WallViewport) => {
  if (!layout.items.length) {
    return []
  }

  const margin = viewport.margin ?? 0
  const top = viewport.top - margin
  const bottom = viewport.top + viewport.height + margin

  let firstVisible = -1
  let lastVisible = -1
  for (const row of layout.rows) {
    if (row.bottom >= top && row.top <= bottom) {
      if (firstVisible === -1) {
        firstVisible = row.startIndex
      }
      lastVisible = row.endIndex
    }
  }

  if (firstVisible === -1) {
    return []
  }

  // Contiguous slice: rows are stored in order, so the visible band is always a
  // single range of items.
  return layout.items.slice(firstVisible, lastVisible + 1)
}
