import './styles/index.css'

import { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'

import { AppSkeleton } from './components/ui/app-skeleton'
import { router } from './router'

createRoot(document.querySelector('#root')!).render(
  <Suspense fallback={<AppSkeleton />}>
    <RouterProvider router={router} />
  </Suspense>,
)

// The precache is a few MB; installing it during the first paint hurts more
// than it helps. Register once the page has had a chance to settle.
if ('serviceWorker' in navigator) {
  window.addEventListener(
    'load',
    () => {
      setTimeout(() => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
          console.warn('Service worker registration failed:', error)
        })
      }, 3000)
    },
    { once: true },
  )
}
