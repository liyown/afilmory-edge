import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import {
  TransformComponent,
  TransformWrapper,
  useTransformContext,
  useTransformEffect,
  useTransformInit,
} from 'react-zoom-pan-pinch'

import { useMobile } from '~/hooks/useMobile'
import { usePhotoViewer } from '~/hooks/usePhotoViewer'
import { useViewport } from '~/hooks/useViewport'
import type { PhotoManifest } from '~/types/photo'

import styles from './wall.module.css'
import type { WallFrameInsets, WallLayout, WallLayoutOptions } from './wall-layout'
import { createWallLayout, sliceVisibleItems, WALL_TOP_INSET } from './wall-layout'
import { WallFrame } from './WallFrame'

const DESKTOP_OPTIONS: Omit<WallLayoutOptions, 'contentWidth'> = {
  minRowHeight: 130,
  maxRowHeight: 230,
  gutter: 48,
  rowGap: 64,
  frame: { side: 18, top: 18, bottom: 58 },
  maxRotation: 2.4,
  maxOffset: 14,
  topPadding: WALL_TOP_INSET + 28,
  bottomPadding: 180,
}

const MOBILE_OPTIONS: Omit<WallLayoutOptions, 'contentWidth'> = {
  minRowHeight: 76,
  maxRowHeight: 150,
  gutter: 14,
  rowGap: 24,
  frame: { side: 10, top: 10, bottom: 34 },
  maxRotation: 2,
  maxOffset: 8,
  topPadding: WALL_TOP_INSET + 24,
  bottomPadding: 150,
}

const MIN_SCALE = 0.25
const MAX_SCALE = 3
const MIN_INITIAL_SCALE = 0.55
const CULLING_MARGIN = 700
const CLICK_SUPPRESS_MS = 280
const GESTURE_WATCHDOG_MS = 260
const ZOOM_ANIMATION_MS = 240
const EASING = 'easeOut' as const

interface WallViewProps {
  photos: PhotoManifest[]
  onVisibleRangeChange?: (startIndex: number, stopIndex: number, items: PhotoManifest[]) => void
}

/**
 * The packing square is a sizing hint, not a hard bound: the layout expands the
 * canvas to whatever the circular cluster actually needs.
 */
const resolveWallWidth = (viewportWidth: number, isMobile: boolean) => {
  if (isMobile) {
    return Math.max(viewportWidth * 2.6, 1000)
  }
  return Math.max(Math.min(viewportWidth * 2.2, 3000), 2200)
}

/**
 * Start on the centre of the cluster so the first screen reads as a circle of
 * photos, letting the user pan outward instead of landing on the canvas edge.
 */
const createInitialView = (viewportWidth: number, viewportHeight: number, layout: WallLayout, isMobile: boolean) => {
  // Centre on the widest row so the first screen shows the belly of the circle;
  // the narrower rows above and below are a short pan away.
  // Fit the whole silhouette on open, so the circular arrangement is obvious
  // before the user starts panning into individual rows.
  const fitScale = Math.min(
    viewportWidth / layout.width,
    (viewportHeight - WALL_TOP_INSET * 2) / Math.max(layout.height, 1),
  )
  const targetScale = Math.min(Math.max(fitScale, MIN_INITIAL_SCALE), isMobile ? 1.1 : 1.05)
  const centerRow = layout.rows[layout.centerRow] ?? layout.rows[0]
  const centerY = centerRow ? (centerRow.top + centerRow.bottom) / 2 : 0
  const visibleHeight = viewportHeight - WALL_TOP_INSET

  return {
    scale: targetScale,
    x: Math.round(viewportWidth / 2 - (layout.width / 2) * targetScale),
    y: Math.round(WALL_TOP_INSET + visibleHeight / 2 - centerY * targetScale),
  }
}

const useRafTransform = () => {
  const instance = useTransformContext()
  const frameRef = useRef(0)
  const callbackRef = useRef<() => void>(() => {})

  const schedule = useCallback(() => {
    if (frameRef.current) {
      return
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      callbackRef.current()
    })
  }, [])

  useTransformEffect(schedule)

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
    }
  }, [])

  return { instance, schedule, callbackRef }
}

interface WallViewportBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Reads the canvas-space viewport, but only re-renders when the set of mounted
 * rings actually changes. Continuous panning otherwise schedules a React update
 * per animation frame, which is what made dragging feel sticky on mobile.
 */
const useWallViewport = (layout: WallLayout, viewportWidth: number, viewportHeight: number): WallViewportBox | null => {
  const { instance, schedule, callbackRef } = useRafTransform()
  const [box, setBox] = useState<WallViewportBox | null>(null)
  const lastKeyRef = useRef('')

  const read = useCallback(() => {
    const { scale, positionX, positionY } = instance.state
    if (!scale || !viewportHeight || !viewportWidth) {
      return
    }
    const next: WallViewportBox = {
      left: -positionX / scale,
      top: -positionY / scale,
      width: viewportWidth / scale,
      height: viewportHeight / scale,
    }

    // Key on the culled row band, not raw coordinates: staying inside the same
    // rows keeps the mounted DOM untouched while panning.
    const visible = sliceVisibleItems(layout, { ...next, margin: CULLING_MARGIN })
    const first = visible[0]?.row ?? -1
    const last = visible.at(-1)?.row ?? -1
    const key = `${first}:${last}`
    if (key === lastKeyRef.current) {
      return
    }
    lastKeyRef.current = key
    setBox(next)
  }, [instance, layout, viewportHeight, viewportWidth])

  useTransformInit(read)

  useEffect(() => {
    callbackRef.current = read
    read()
  }, [callbackRef, read])

  useEffect(() => {
    schedule()
  }, [schedule])

  return box
}

const useWallScale = () => {
  const { instance, schedule, callbackRef } = useRafTransform()
  const [scale, setScale] = useState(() => Math.round(instance.state.scale * 100))

  const read = useCallback(() => {
    const next = Math.round(instance.state.scale * 100)
    setScale((previous) => (previous === next ? previous : next))
  }, [instance])

  useTransformInit(read)

  useEffect(() => {
    callbackRef.current = read
    read()
  }, [callbackRef, read])

  useEffect(() => {
    schedule()
  }, [schedule])

  return scale
}

const WallCanvas = ({
  layout,
  photos,
  insets,
  onOpen,
  onVisibleRangeChange,
}: {
  layout: WallLayout
  photos: PhotoManifest[]
  insets: WallFrameInsets
  onOpen: (index: number, element: HTMLElement) => void
  onVisibleRangeChange?: WallViewProps['onVisibleRangeChange']
}) => {
  const viewportWidth = useViewport((viewport) => viewport.w)
  const viewportHeight = useViewport((viewport) => viewport.h)
  const box = useWallViewport(layout, viewportWidth, viewportHeight)
  const lastReportedRef = useRef<{ first: number; last: number } | null>(null)

  const visibleItems = useMemo(
    () => (box ? sliceVisibleItems(layout, { ...box, margin: CULLING_MARGIN }) : []),
    [box, layout],
  )

  useEffect(() => {
    if (!onVisibleRangeChange || !visibleItems.length) {
      return
    }
    // Items come back in layout order; the first/last indices describe the
    // mounted band, which is what the header date range wants.
    const first = visibleItems[0].index
    const last = visibleItems.at(-1)?.index ?? first
    const previous = lastReportedRef.current
    if (previous?.first === first && previous.last === last) {
      return
    }
    lastReportedRef.current = { first, last }
    onVisibleRangeChange(first, last, photos)
  }, [onVisibleRangeChange, photos, visibleItems])

  return (
    <>
      {visibleItems.map((item) => {
        const photo = photos[item.index]
        if (!photo) {
          return null
        }
        return <WallFrame key={item.id} item={item} photo={photo} insets={insets} onOpen={onOpen} />
      })}
    </>
  )
}

const ZoomControls = ({
  onResetView,
  onResetZoom,
  onZoomStep,
}: {
  onResetView: () => void
  onResetZoom: () => void
  onZoomStep: (direction: 1 | -1) => void
}) => {
  const { t } = useTranslation()
  const scale = useWallScale()

  const buttonClass =
    'text-text-secondary hover:text-text hover:bg-fill-tertiary focus-visible:ring-accent/50 flex size-8 items-center justify-center rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none'

  return (
    <div
      data-wall-controls
      className="bg-material-thick/80 border-accent/20 shadow-context-menu flex items-center gap-0.5 rounded-full border p-1 backdrop-blur-2xl"
    >
      <button
        type="button"
        aria-label={t('wall.zoom.out')}
        title={t('wall.zoom.out')}
        onClick={() => onZoomStep(-1)}
        className={buttonClass}
      >
        <i className="i-mingcute-zoom-out-line text-base" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={t('wall.zoom.level')}
        title={t('wall.zoom.level')}
        onClick={onResetZoom}
        className="text-text-secondary hover:text-text focus-visible:ring-accent/50 min-w-11 rounded-full px-1 text-xs font-medium tabular-nums transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none"
      >
        {scale}%
      </button>
      <button
        type="button"
        aria-label={t('wall.zoom.in')}
        title={t('wall.zoom.in')}
        onClick={() => onZoomStep(1)}
        className={buttonClass}
      >
        <i className="i-mingcute-zoom-in-line text-base" aria-hidden="true" />
      </button>
      <span className="bg-fill-tertiary mx-0.5 h-5 w-px" aria-hidden="true" />
      <button
        type="button"
        aria-label={t('wall.view.reset')}
        title={t('wall.view.reset')}
        onClick={onResetView}
        className={buttonClass}
      >
        <i className="i-mingcute-target-line text-base" aria-hidden="true" />
      </button>
    </div>
  )
}

const WallHint = ({ visible }: { visible: boolean }) => {
  const { t } = useTranslation()

  return (
    <div
      className={`bg-material-medium/70 border-white/10 text-text-secondary pointer-events-none hidden items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs backdrop-blur-2xl transition-opacity duration-300 sm:flex ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <i className="i-mingcute-hand-line text-sm" aria-hidden="true" />
      <span>{t('wall.hint.pan')}</span>
      <span className="bg-fill-tertiary h-3 w-px" aria-hidden="true" />
      <i className="i-mingcute-zoom-in-line text-sm" aria-hidden="true" />
      <span>{t('wall.hint.zoom')}</span>
    </div>
  )
}

export const WallView = ({ photos, onVisibleRangeChange }: WallViewProps) => {
  const { t } = useTranslation()
  const isMobile = useMobile()
  const viewportWidth = useViewport((viewport) => viewport.w)
  const viewportHeight = useViewport((viewport) => viewport.h)
  const photoViewer = usePhotoViewer()
  const transformRef = useRef<ReactZoomPanPinchRef>(null)
  const suppressClickUntilRef = useRef(0)
  const panMovedRef = useRef(false)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const [hasInteracted, setHasInteracted] = useState(false)
  const gestureRef = useRef(false)
  const gestureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const applyGesture = useCallback((active: boolean) => {
    if (gestureRef.current === active) {
      return
    }
    gestureRef.current = active
    const wall = transformRef.current?.instance.wrapperComponent
    if (!wall) {
      return
    }
    if (active) {
      wall.dataset.wallGesture = 'true'
    } else {
      delete wall.dataset.wallGesture
    }
  }, [])

  const setGesture = useCallback(
    (active: boolean) => {
      if (gestureTimerRef.current) {
        clearTimeout(gestureTimerRef.current)
        gestureTimerRef.current = null
      }
      applyGesture(active)
      if (active) {
        gestureTimerRef.current = setTimeout(() => {
          gestureTimerRef.current = null
          applyGesture(false)
        }, GESTURE_WATCHDOG_MS)
      }
    },
    [applyGesture],
  )

  useEffect(
    () => () => {
      if (gestureTimerRef.current) {
        clearTimeout(gestureTimerRef.current)
        gestureTimerRef.current = null
      }
      applyGesture(false)
    },
    [applyGesture],
  )

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-wall-controls]')) {
        return
      }
      pointerRef.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', handlePointerMove)
  }, [])

  const options = useMemo<WallLayoutOptions>(
    () => ({
      ...(isMobile ? MOBILE_OPTIONS : DESKTOP_OPTIONS),
      contentWidth: resolveWallWidth(viewportWidth || 1440, isMobile),
    }),
    [isMobile, viewportWidth],
  )

  const layout = useMemo(() => createWallLayout(photos, options), [options, photos])
  const insets = useMemo(() => options.frame, [options])

  const initialViewRef = useRef(createInitialView(viewportWidth || 1440, viewportHeight || 900, layout, isMobile))
  const fittedLayoutRef = useRef(layout)

  useEffect(() => {
    if (fittedLayoutRef.current === layout) {
      return
    }
    fittedLayoutRef.current = layout
    const next = createInitialView(viewportWidth || 1440, viewportHeight || 900, layout, isMobile)
    initialViewRef.current = next
    const frame = requestAnimationFrame(() => {
      transformRef.current?.setTransform(next.x, next.y, next.scale, ZOOM_ANIMATION_MS, EASING)
    })
    return () => cancelAnimationFrame(frame)
  }, [isMobile, layout, viewportHeight, viewportWidth])

  const markInteracted = useCallback(() => {
    setHasInteracted(true)
  }, [])

  const openViewerRef = useRef(photoViewer.openViewer)
  useEffect(() => {
    openViewerRef.current = photoViewer.openViewer
  }, [photoViewer.openViewer])

  const handleOpen = useCallback((index: number, element: HTMLElement) => {
    if (Date.now() < suppressClickUntilRef.current) {
      return
    }
    openViewerRef.current(index, element)
  }, [])

  const resetView = useCallback(() => {
    const { scale, x, y } = initialViewRef.current
    transformRef.current?.setTransform(x, y, scale, ZOOM_ANIMATION_MS, EASING)
  }, [])

  const zoomStep = useCallback(
    (direction: 1 | -1) => {
      const ref = transformRef.current
      if (!ref) {
        return
      }
      const { scale } = ref.state
      const targetScale = Math.min(Math.max(scale + direction * 0.25, MIN_SCALE), MAX_SCALE)
      const rect = ref.instance.wrapperComponent?.getBoundingClientRect()
      const pointer = pointerRef.current
      const clientX =
        pointer && rect
          ? Math.min(Math.max(pointer.x, rect.left), rect.right)
          : rect
            ? rect.left + rect.width / 2
            : viewportWidth / 2
      const clientY =
        pointer && rect
          ? Math.min(Math.max(pointer.y, rect.top), rect.bottom)
          : rect
            ? rect.top + rect.height / 2
            : viewportHeight / 2
      void ref.zoomToPoint(targetScale, clientX, clientY, ZOOM_ANIMATION_MS, EASING)
      markInteracted()
    },
    [markInteracted, viewportHeight, viewportWidth],
  )

  const resetZoom = useCallback(() => {
    const ref = transformRef.current
    if (!ref) {
      return
    }
    const { scale, positionX, positionY } = ref.state
    const wrapper = ref.instance.wrapperComponent
    const centerX = (wrapper?.clientWidth ?? viewportWidth) / 2
    const centerY = (wrapper?.clientHeight ?? viewportHeight) / 2
    ref.setTransform(
      centerX - (centerX - positionX) / scale,
      centerY - (centerY - positionY) / scale,
      1,
      ZOOM_ANIMATION_MS,
      EASING,
    )
  }, [viewportHeight, viewportWidth])

  return (
    <div className="fixed inset-0 z-0" role="region" aria-label={t('gallery.view.wall')}>
      <TransformWrapper
        ref={transformRef}
        initialScale={initialViewRef.current.scale}
        initialPositionX={initialViewRef.current.x}
        initialPositionY={initialViewRef.current.y}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        limitToBounds
        centerZoomedOut={false}
        doubleClick={{ disabled: true }}
        wheel={{ step: 0.0015 }}
        trackPadPanning={{ disabled: true }}
        panning={{ velocityDisabled: false }}
        keyboard={{ disabled: false, panStep: 90, zoomStep: 0.2 }}
        zoomAnimation={{ animationTime: ZOOM_ANIMATION_MS }}
        velocityAnimation={{ animationTime: 260, maxAnimationTime: 700 }}
        onPanningStart={() => {
          panMovedRef.current = false
          setGesture(true)
          markInteracted()
        }}
        onPanning={() => {
          panMovedRef.current = true
        }}
        onPanningStop={() => {
          setGesture(false)
          if (panMovedRef.current) {
            suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESS_MS
          }
        }}
        onZoomStart={() => {
          setGesture(true)
          markInteracted()
        }}
        onZoomStop={() => setGesture(false)}
        onWheelStart={() => {
          setGesture(true)
          markInteracted()
        }}
        onWheelStop={() => setGesture(false)}
      >
        <TransformComponent
          wrapperClass={styles.wall}
          wrapperStyle={{ width: '100%', height: '100%', cursor: 'grab' }}
          contentStyle={{
            position: 'relative',
            display: 'block',
            width: layout.width,
            height: layout.height,
            backfaceVisibility: 'hidden',
            contain: 'layout style',
          }}
        >
          <WallCanvas
            layout={layout}
            photos={photos}
            insets={insets}
            onOpen={handleOpen}
            onVisibleRangeChange={onVisibleRangeChange}
          />
        </TransformComponent>

        <div className={`${styles.vignette} absolute inset-0 z-10`} aria-hidden="true" />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex items-end justify-between gap-3 px-4 pt-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:px-6 lg:pb-[calc(5rem+env(safe-area-inset-bottom))]">
          <WallHint visible={!hasInteracted && photos.length > 0} />
          <div className="pointer-events-auto ml-auto">
            <ZoomControls onResetView={resetView} onResetZoom={resetZoom} onZoomStep={zoomStep} />
          </div>
        </div>

        {photos.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="bg-material-thick/80 border-accent/20 text-text-secondary flex flex-col items-center gap-3 rounded-2xl border px-8 py-7 text-center backdrop-blur-2xl">
              <i className="i-mingcute-photo-album-line text-2xl" aria-hidden="true" />
              <p className="text-sm">{t('wall.empty')}</p>
            </div>
          </div>
        )}
      </TransformWrapper>
    </div>
  )
}
