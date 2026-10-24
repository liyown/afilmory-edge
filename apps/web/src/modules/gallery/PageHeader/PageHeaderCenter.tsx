import { Spring } from '@afilmory/utils'
import { useAtomValue } from 'jotai'
import { AnimatePresence, m } from 'motion/react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { gallerySettingAtom } from '~/atoms/app'

interface PageHeaderCenterProps {
  dateRange?: string
  location?: string
  showDateRange?: boolean
}

export const PageHeaderCenter = ({ dateRange, location, showDateRange }: PageHeaderCenterProps) => {
  const { t } = useTranslation()
  const { searchQuery } = useAtomValue(gallerySettingAtom)

  const translateDay = useCallback((day: string | number) => t(`date.day.${day}` as any), [t])
  const translateMonth = useCallback((month: string | number) => t(`date.month.${month}` as any), [t])

  // 解析日期范围，提取主要的日期信息
  const parseMainDate = useCallback(
    (range: string) => {
      // 匹配跨年日期范围格式 "2022年3月 - 2023年5月"
      const crossYearMatch = range.match(/(\d{4})年(\d+)月\s*-\s*(\d{4})年(\d+)月/)
      if (crossYearMatch) {
        const [, startYear, startMonth, endYear, endMonth] = crossYearMatch
        return `${translateMonth(startMonth)} ${startYear} - ${translateMonth(endMonth)} ${endYear}`
      }

      // 匹配类似 "2022年3月30日 - 5月2日" 的格式
      const singleYearDayMatch = range.match(/(\d{4})年(\d+)月(\d+)日?\s*-\s*(\d+)月(\d+)日?/)
      if (singleYearDayMatch) {
        const [, year, startMonth, startDay, endMonth, endDay] = singleYearDayMatch
        return `${translateMonth(startMonth)} ${translateDay(startDay)} - ${translateMonth(endMonth)} ${translateDay(endDay)} ${year}`
      }

      // 匹配类似 "2022年3月 - 5月" 的格式
      const monthRangeMatch = range.match(/(\d{4})年(\d+)月\s*-\s*(\d+)月/)
      if (monthRangeMatch) {
        const [, year, startMonth, endMonth] = monthRangeMatch
        return `${translateMonth(startMonth)} - ${translateMonth(endMonth)} ${year}`
      }

      // 匹配单个日期
      const singleDateMatch = range.match(/(\d{4})年(\d+)月(\d+)日/)
      if (singleDateMatch) {
        const [, year, month, day] = singleDateMatch
        return `${translateMonth(month)} ${translateDay(day)} ${year}`
      }

      // 默认返回原始字符串
      return range
    },
    [translateDay, translateMonth],
  )

  const formattedDate = useMemo(() => (dateRange ? parseMainDate(dateRange) : undefined), [dateRange, parseMainDate])

  const visible = showDateRange && formattedDate && !searchQuery.trim()

  return (
    <AnimatePresence>
      {visible && (
        <m.div
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 6, opacity: 0 }}
          transition={Spring.presets.smooth}
          className="hidden min-w-0 items-center gap-2 border-l border-white/10 pl-3 lg:flex"
        >
          <span className="truncate font-mono text-[10px] tracking-[0.16em] text-white/55 uppercase">
            {formattedDate}
          </span>
          {location && (
            <span className="truncate font-mono text-[9px] tracking-[0.14em] text-white/30 uppercase">{location}</span>
          )}
        </m.div>
      )}
    </AnimatePresence>
  )
}
