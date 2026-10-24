import { LinearBlur } from '@afilmory/ui'

import { PageHeaderCenter } from './PageHeaderCenter'
import { PageHeaderLeft } from './PageHeaderLeft'
import { PageHeaderRight } from './PageHeaderRight'
import { PageHeaderSearch } from './PageHeaderSearch'
import { ViewModeSegment } from './ViewModeSegment'

interface PageHeaderProps {
  dateRange?: string
  location?: string
  showDateRange?: boolean
}

export const PageHeader = ({ dateRange, location, showDateRange }: PageHeaderProps) => {
  return (
    <header className="fixed top-0 right-0 left-0 z-30">
      <LinearBlur
        className="pointer-events-none absolute inset-x-0 z-[-1] h-15"
        tint="var(--color-background)"
        strength={128}
        side="top"
      />
      <div className="flex h-12 items-center justify-between gap-2 px-3 lg:h-14 lg:gap-3 lg:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <PageHeaderLeft />
          <PageHeaderCenter dateRange={dateRange} location={location} showDateRange={showDateRange} />
        </div>
        <PageHeaderSearch />
        <div className="flex items-center gap-1.5 lg:gap-2">
          <div className="hidden sm:block">
            <ViewModeSegment />
          </div>
          <PageHeaderRight />
        </div>
      </div>
    </header>
  )
}
