import { useAtomValue } from 'jotai'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { gallerySettingAtom } from '~/atoms/app'
import { useMobile } from '~/hooks/useMobile'
import type { PhotoManifest } from '~/types/photo'

import type { MasonryRef } from './Masonic'
import { Masonry } from './Masonic'
import { MasonryPhotoItem } from './MasonryPhotoItem'

const COLUMN_WIDTH_CONFIG = {
  auto: {
    mobile: 165,
    desktop: 300,
    maxColumns: 6,
  },
  min: {
    mobile: 140,
    desktop: 220,
  },
  max: {
    mobile: 280,
    desktop: 520,
  },
}

interface MasonryViewProps {
  photos: PhotoManifest[]
  onRender?: (startIndex: number, stopIndex: number, items: any[]) => void
}

export const MasonryView = ({ photos, onRender }: MasonryViewProps) => {
  const { columns } = useAtomValue(gallerySettingAtom)
  const [containerWidth, setContainerWidth] = useState(0)
  const masonryRef = useRef<MasonryRef>(null)
  const isMobile = useMobile()

  // 监听容器宽度变化
  useEffect(() => {
    const updateContainerWidth = () => {
      setContainerWidth(window.innerWidth)
    }

    updateContainerWidth()
    window.addEventListener('resize', updateContainerWidth)

    return () => {
      window.removeEventListener('resize', updateContainerWidth)
    }
  }, [])

  // 动态计算列宽
  const columnWidth = useMemo(() => {
    const { auto, min, max } = COLUMN_WIDTH_CONFIG
    const gutter = isMobile ? 8 : 14 // 列间距
    // Matches the page container padding: px-4 / lg:px-8 / xl:px-12.
    const horizontalPadding = isMobile ? 32 : containerWidth >= 1280 ? 96 : containerWidth >= 1024 ? 64 : 32
    const availableWidth = containerWidth - horizontalPadding

    if (columns === 'auto') {
      const autoWidth = isMobile ? auto.mobile : auto.desktop
      if (!isMobile) {
        const { maxColumns } = auto
        // 当屏幕宽度超过一定阈值时，通过计算动态列宽来限制最大列数
        const colCount = Math.floor((availableWidth + gutter) / (autoWidth + gutter))

        if (colCount > maxColumns) {
          return (availableWidth - (maxColumns - 1) * gutter) / maxColumns
        }
      }

      return autoWidth
    }

    // 自定义列数模式：根据容器宽度和列数计算列宽
    const calculatedWidth = (availableWidth - (columns - 1) * gutter) / columns

    // 根据设备类型设置最小和最大列宽
    const minWidth = isMobile ? min.mobile : min.desktop
    const maxWidth = isMobile ? max.mobile : max.desktop

    return Math.max(Math.min(calculatedWidth, maxWidth), minWidth)
  }, [isMobile, columns, containerWidth])

  const gutter = isMobile ? 8 : 14

  // Masonic estimates the height of not-yet-measured items. A fixed guess is
  // far off when the archive is portrait- or landscape-heavy, which makes the
  // document height collapse as items get measured mid-scroll. Derive the
  // average from the real aspect ratios instead.
  const itemHeightEstimate = useMemo(() => {
    const fallback = isMobile ? 180 : 260
    if (photos.length === 0 || columnWidth <= 0) {
      return fallback
    }

    let total = 0
    let count = 0
    for (const photo of photos) {
      const ratio = photo.aspectRatio
      if (typeof ratio === 'number' && ratio > 0.1 && ratio < 10) {
        total += columnWidth / ratio
        count++
      }
    }

    return count > 0 ? Math.round(total / count) : fallback
  }, [photos, columnWidth, isMobile])

  return (
    <Masonry<PhotoManifest>
      ref={masonryRef}
      items={photos}
      render={useCallback(
        (props) => (
          <MasonryItem {...props} />
        ),
        [],
      )}
      onRender={onRender}
      columnWidth={columnWidth}
      columnGutter={gutter}
      rowGutter={gutter}
      itemHeightEstimate={itemHeightEstimate}
      itemKey={useCallback((data, _index) => {
        return data.id
      }, [])}
    />
  )
}

const MasonryItem = memo(MasonryPhotoItem)
