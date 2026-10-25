import { useEffect } from 'react'
import { Outlet } from 'react-router'

import { useCommandPaletteShortcut } from './hooks/useCommandPaletteShortcut'
import { CommandPalette } from './modules/cmdk/CommandPalette'
import { RootProviders } from './providers/root-providers'

const loadPhotoDetail = () => import('~/pages/(main)/photos/[photoId]/index')

/**
 * The detail route pulls in the viewer, EXIF panel and map helpers. Fetching it
 * during the first paint competes with the gallery images, but waiting until
 * the first click costs a full round-trip. Prefetch it once the page has
 * loaded, or as soon as the pointer/touch indicates intent.
 */
function usePhotoDetailPrefetch() {
  useEffect(() => {
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string }
      }
    ).connection

    if (connection?.saveData || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') {
      return
    }

    let started = false
    let idleId: number | undefined
    let timerId: number | undefined

    const prefetch = () => {
      if (started) {
        return
      }
      started = true
      void loadPhotoDetail()
    }

    const schedule = () => {
      timerId = window.setTimeout(() => {
        if ('requestIdleCallback' in window) {
          idleId = window.requestIdleCallback(prefetch, { timeout: 4000 })
        } else {
          prefetch()
        }
      }, 2000)
    }

    if (document.readyState === 'complete') {
      schedule()
    } else {
      window.addEventListener('load', schedule, { once: true })
    }

    // Mouse and touch intent arrive before the click handler, which gives the
    // chunk a head start when the idle prefetch has not run yet.
    const onPointerOver = () => prefetch()
    window.addEventListener('pointerover', onPointerOver, { capture: true, passive: true, once: true })
    window.addEventListener('touchstart', onPointerOver, { capture: true, passive: true, once: true })

    return () => {
      window.removeEventListener('load', schedule)
      window.removeEventListener('pointerover', onPointerOver, { capture: true })
      window.removeEventListener('touchstart', onPointerOver, { capture: true })
      if (idleId !== undefined && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      }
      if (timerId !== undefined) {
        clearTimeout(timerId)
      }
    }
  }, [])
}

function App() {
  usePhotoDetailPrefetch()

  return (
    <RootProviders>
      <div className="overflow-hidden lg:h-svh">
        <Outlet />
        <CommandPaletteContainer />
      </div>
    </RootProviders>
  )
}

const CommandPaletteContainer = () => {
  const { isOpen, setIsOpen } = useCommandPaletteShortcut()
  return <CommandPalette isOpen={isOpen} onClose={() => setIsOpen(false)} />
}
export default App
