import { env } from 'cloudflare:workers'

import { getCoreApp } from './core-app'
import { getDatabaseHealthApp } from './core-database'
import { homepageOgCacheKey, photoOgCacheKey, runScheduled } from './cron'
import { loadManifest, serveAppShell, servePhotoShell, serveWebManifest, toInlineJson } from './html'
import { decodeMediaKey, isPublicMediaKey } from './media-key'
import { renderHomepageOgImage, renderPhotoOgImage } from './og'
import { loadOgSiteConfig } from './og-site'
import type { OgPhoto } from './og-template'
import { storageGet, storageHead, storagePut } from './storage'

const DASHBOARD_BASENAME = '/platform'
const DASHBOARD_ALIAS = '/dashboard'
const ASSET_EXTENSION_PATTERN = /\.[a-z0-9]+$/i
// Vite fingerprints everything under these prefixes, so the bytes behind a URL
// never change. Workers Assets defaults to `max-age=0, must-revalidate`, which
// forces a revalidation round-trip on every visit.
const IMMUTABLE_ASSET_PREFIXES = ['/assets/', '/vendor/', '/platform/assets/', '/platform/vendor/']

function withImmutableAssetCache(response: Response, pathname: string): Response {
  if (!IMMUTABLE_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return response
  }

  const headers = new Headers(response.headers)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

// These responses exist to be embedded by third-party sites.
const EMBEDDABLE_PATHS = new Set(['/share/iframe', '/share/embed.js'])

function hardenResponse(response: Response, request: Request): Response {
  const { pathname, protocol } = new URL(request.url)

  // Leave API/auth responses untouched: Better Auth sets multiple cookies and
  // CORS headers are owned by its middleware.
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return response
  }

  const headers = new Headers(response.headers)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(self)')

  if (protocol === 'https:') {
    headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains')
  }

  if (!EMBEDDABLE_PATHS.has(pathname)) {
    headers.set('x-frame-options', 'SAMEORIGIN')
  }

  // Media may be uploaded SVG/HTML; the sandbox keeps direct visits inert.
  if (pathname.startsWith('/media/')) {
    headers.set('content-security-policy', "default-src 'none'; sandbox")
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * The dashboard is a separate SPA built with `base: '/platform/'`.
 * Existing files are served verbatim; client-side routes fall back to its
 * index.html instead of the gallery shell.
 */
async function serveDashboardAsset(request: Request): Promise<Response> {
  const url = new URL(request.url)

  if (ASSET_EXTENSION_PATTERN.test(url.pathname)) {
    return withImmutableAssetCache(await env.ASSETS.fetch(request), url.pathname)
  }

  const assetResponse = await env.ASSETS.fetch(new URL(`${DASHBOARD_BASENAME}/index.html`, request.url))
  if (!assetResponse.ok) {
    return assetResponse
  }

  const site = await loadOgSiteConfig(env)
  const title = `${site.title || site.name} Dashboard`
  const configScript = `window.__SITE_CONFIG__ = ${toInlineJson({ name: site.name, title: site.title })};`

  return new HTMLRewriter()
    .on('head', {
      element(element) {
        element.prepend(`<script>${configScript}</script>`, { html: true })
      },
    })
    .on('title', {
      element(element) {
        element.setInnerContent(title)
      },
    })
    .on('meta[name="description"]', {
      element(element) {
        element.setAttribute('content', `${site.name} Dashboard`)
      },
    })
    .transform(
      new Response(assetResponse.body, {
        status: assetResponse.status,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          // The injected name/title must not be cached by the CDN.
          'cache-control': 'no-store',
        },
      }),
    )
}

function writeLog(payload: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload))
}

function parseByteRange(header: string | null): { offset: number; length: number } | undefined {
  if (!header) {
    return undefined
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim())
  if (!match) {
    return undefined
  }

  const offset = Number(match[1])
  const end = match[2] === '' ? undefined : Number(match[2])
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return undefined
  }
  if (end !== undefined && (!Number.isSafeInteger(end) || end < offset)) {
    return undefined
  }

  return { offset, length: end === undefined ? Number.MAX_SAFE_INTEGER : end - offset + 1 }
}

/** Structured access log for HTML/API traffic (skip bytes and assets). */
function shouldLogRequest(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/feed.xml' ||
    pathname === '/sitemap.xml' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/photos/') ||
    pathname.startsWith('/og/') ||
    pathname.startsWith('/share/')
  )
}

async function handleRequest(request: Request, executionCtx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/health') {
    return Response.json({
      ok: true,
      worker: 'afilmory-edge',
      ts: new Date().toISOString(),
    })
  }

  // Redirect the legacy `/dashboard` path to the dashboard's native base path.
  if (url.pathname === DASHBOARD_ALIAS || url.pathname.startsWith(`${DASHBOARD_ALIAS}/`)) {
    const target = new URL(request.url)
    const suffix = url.pathname.slice(DASHBOARD_ALIAS.length)
    target.pathname = suffix ? `${DASHBOARD_BASENAME}${suffix}` : `${DASHBOARD_BASENAME}/`
    return Response.redirect(target.toString(), 302)
  }

  if (url.pathname === DASHBOARD_BASENAME || url.pathname.startsWith(`${DASHBOARD_BASENAME}/`)) {
    return await serveDashboardAsset(request)
  }

  if (url.pathname === '/manifest.webmanifest' || url.pathname === '/site.webmanifest') {
    return await serveWebManifest(env)
  }

  if (url.pathname === '/api/health') {
    const app = await getDatabaseHealthApp()
    return app.getInstance().fetch(request, undefined, executionCtx)
  }

  if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    const app = await getCoreApp()
    return app.getInstance().fetch(request, undefined, executionCtx)
  }

  if (url.pathname === '/api/manifest') {
    return Response.json(await loadManifest(env))
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    const app = await getCoreApp()
    return app.getInstance().fetch(request, undefined, executionCtx)
  }

  // Feed, sitemap, and embed responses are generated by the core graph.
  if (
    url.pathname === '/feed.xml' ||
    url.pathname === '/sitemap.xml' ||
    url.pathname === '/share/iframe' ||
    url.pathname === '/share/embed.js'
  ) {
    const app = await getCoreApp()
    return app.getInstance().fetch(request, undefined, executionCtx)
  }

  // HTML shell with injected manifest. Asset paths keep their file extension;
  // every other path is a client-side route that needs the injected shell.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return serveAppShell(request, env)
  }

  const photoMatch = /^\/photos\/([^/]+)\/?$/.exec(url.pathname)
  if (photoMatch) {
    return servePhotoShell(request, env, decodeURIComponent(photoMatch[1]))
  }

  // Serve photo bytes from OSS through the Worker (originals + thumbnails).
  const mediaMatch = /^\/media\/(.+)$/.exec(url.pathname)
  if (mediaMatch) {
    const key = decodeMediaKey(mediaMatch[1])
    if (!key || !isPublicMediaKey(key)) {
      return new Response('Not Found', { status: 404 })
    }
    // Video and Live Photo playback needs byte ranges; a ranged read also
    // avoids downloading the whole original for a seek.
    const requestedRange = parseByteRange(request.headers.get('range'))
    if (requestedRange) {
      const info = await storageHead(key)
      if (!info) {
        return new Response('Not Found', { status: 404 })
      }
      if (requestedRange.offset >= info.size) {
        return new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${info.size}` },
        })
      }
    }

    const object = await storageGet(
      key,
      requestedRange ? { offset: requestedRange.offset, length: requestedRange.length } : undefined,
    )
    if (!object) {
      return new Response('Not Found', { status: 404 })
    }
    const headers = new Headers()
    const contentType = object.response.headers.get('content-type')
    if (contentType) {
      headers.set('content-type', contentType)
    }
    const etag = object.response.headers.get('etag')
    if (etag) {
      headers.set('etag', etag)
    }
    for (const name of ['content-range', 'content-length'] as const) {
      const value = object.response.headers.get(name)
      if (value) {
        headers.set(name, value)
      }
    }
    headers.set('accept-ranges', 'bytes')
    headers.set('cache-control', 'public, max-age=31536000, immutable')
    return new Response(object.response.body, {
      status: requestedRange && headers.has('content-range') ? 206 : 200,
      headers,
    })
  }

  // Homepage card. Kept separate from the photo route so `/og/` is a valid
  // canonical URL for crawlers.
  if (url.pathname === '/og' || url.pathname === '/og/') {
    const manifest = await loadManifest(env)
    const photos = ((manifest.data ?? []) as OgPhoto[]).filter((photo) => typeof photo?.id === 'string')
    const cameras = Array.isArray(manifest.cameras) ? manifest.cameras.length : 0
    const site = await loadOgSiteConfig(env)
    return await serveOgImage(env, homepageOgCacheKey(site, photos), async () =>
      renderHomepageOgImage(env, site, photos, cameras, url.origin),
    )
  }

  const ogMatch = /^\/og\/([^/]+)\/?$/.exec(url.pathname)
  if (ogMatch) {
    const manifest = await loadManifest(env)
    const photoId = decodeURIComponent(ogMatch[1])
    const photo = ((manifest.data ?? []) as OgPhoto[]).find((item) => item.id === photoId)

    if (!photo) {
      return new Response('Not Found', { status: 404 })
    }

    const site = await loadOgSiteConfig(env)
    return await serveOgImage(env, photoOgCacheKey(photo, site), async () =>
      renderPhotoOgImage(env, photo, site, url.origin),
    )
  }

  if (ASSET_EXTENSION_PATTERN.test(url.pathname)) {
    return withImmutableAssetCache(await env.ASSETS.fetch(request), url.pathname)
  }

  // Any other extensionless path is a gallery client-side route (`/map`,
  // `/manifest`, future pages), so it gets the same injected shell as `/`.
  return await serveAppShell(request, env)
}

/**
 * Serve the pre-rendered card when cron (or a previous request) produced one;
 * otherwise render and cache it for the next visitor.
 */
async function serveOgImage(env: Env, cacheKey: string, render: () => Promise<Uint8Array>): Promise<Response> {
  const cached = await storageGet(cacheKey)
  if (cached) {
    const headers = new Headers()
    const etag = cached.response.headers.get('etag')
    if (etag) {
      headers.set('etag', etag)
    }
    headers.set('content-type', 'image/png')
    headers.set('cache-control', 'public, max-age=86400')
    headers.set('x-og-cache', 'hit')
    return new Response(cached.response.body, { headers })
  }

  const body = await render()
  await storagePut(cacheKey, body, {
    contentType: 'image/png',
    cacheControl: 'public, max-age=86400',
  })
  return new Response(body, {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400', 'x-og-cache': 'miss' },
  })
}

export default {
  async fetch(request: Request, _runtimeEnv: Env, executionCtx: ExecutionContext): Promise<Response> {
    const started = performance.now()
    const { pathname } = new URL(request.url)

    try {
      const response = await handleRequest(request, executionCtx)
      if (shouldLogRequest(pathname)) {
        writeLog({
          event: 'request',
          method: request.method,
          path: pathname,
          status: response.status,
          durationMs: Math.round(performance.now() - started),
        })
      }
      return hardenResponse(response, request)
    } catch (error) {
      writeLog({
        event: 'request.error',
        method: request.method,
        path: pathname,
        durationMs: Math.round(performance.now() - started),
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },

  async scheduled(controller: ScheduledController, runtimeEnv: Env): Promise<void> {
    try {
      await runScheduled(controller.cron, runtimeEnv)
    } catch (error) {
      writeLog({
        event: 'cron.error',
        cron: controller.cron,
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },
} satisfies ExportedHandler<Env>
