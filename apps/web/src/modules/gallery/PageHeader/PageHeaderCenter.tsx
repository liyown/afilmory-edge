import { Spring } from '@afilmory/utils'
import { useAtomValue } from 'jotai'
import { AnimatePresence, m } from 'motion/react'

import { gallerySettingAtom } from '~/atoms/app'

interface PageHeaderCenterProps {
  dateRange?: string
  location?: string
  showDateRange?: boolean
}

export const PageHeaderCenter = ({ dateRange, location, showDateRange }: PageHeaderCenterProps) => {
  const { searchQuery } = useAtomValue(gallerySettingAtom)

  // The range is already localised by `Intl.DateTimeFormat` where it is
  // computed, so it is rendered as-is instead of being parsed back out of a
  // hand-written Chinese format.
  const visible = showDateRange && dateRange && !searchQuery.trim()

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
          <span className="truncate font-mono text-[10px] tracking-[0.16em] text-white/55 uppercase">{dateRange}</span>
          {location && (
            <span className="truncate font-mono text-[9px] tracking-[0.14em] text-white/30 uppercase">{location}</span>
          )}
        </m.div>
      )}
    </AnimatePresence>
  )
}
