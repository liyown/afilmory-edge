// Serve the SPA shell with the live manifest/config injected before it
// reaches the browser.
//
// The SPA may be built with `AFILMORY_EMBED_MANIFEST=false`, but the shell must
// still work for builds that embedded the defaults: the Worker replaces both
// scripts and removes the build-time `config-runtime` script.

import type { OgSiteConfig } from './og-site'
import { loadOgSiteConfig } from './og-site'
import { storageGet } from './storage'

const MANIFEST_KEY = 'manifest.json'
const MANIFEST_CACHE_KEY = 'manifest:cache'
const MANIFEST_CACHE_TTL_SECONDS = 60

const RUNTIME_CONFIG = {
  useApi: false,
  useCloud: true,
}

type ManifestPayload = Record<string, unknown>

const EMPTY_MANIFEST: ManifestPayload = {
  version: 'v0',
  data: [],
  cameras: [],
  lenses: [],
}

export async function loadManifest(env: Pick<Env, 'CACHE'>): Promise<ManifestPayload> {
  const cached = await env.CACHE.get(MANIFEST_CACHE_KEY)
  if (cached) {
    return JSON.parse(cached) as ManifestPayload
  }

  const object = await storageGet(MANIFEST_KEY)
  if (!object) {
    return EMPTY_MANIFEST
  }

  const text = await object.response.text()
  await env.CACHE.put(MANIFEST_CACHE_KEY, text, { expirationTtl: MANIFEST_CACHE_TTL_SECONDS })

  return JSON.parse(text) as ManifestPayload
}

const PWA_ICONS = [
  { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
  { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
  { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
]

/** PWA manifest rendered from D1 so installs match the live site settings. */
export async function serveWebManifest(env: Env): Promise<Response> {
  const site = await loadOgSiteConfig(env)
  const payload = {
    name: site.siteConfig.title,
    short_name: site.siteConfig.name,
    description: site.siteConfig.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#1c1c1e',
    theme_color: '#1c1c1e',
    lang: 'en',
    scope: '/',
    icons: PWA_ICONS,
  }
  return Response.json(payload, {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}

/** JSON safe to embed inside a `<script>` element. */
export function toInlineJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

interface ShellMeta {
  title: string
  description: string
  image: string
  url: string
}

interface ShellOptions extends ShellMeta {
  status: number
  manifest: ManifestPayload
  site: OgSiteConfig
}

async function renderShell(request: Request, env: Env, options: ShellOptions): Promise<Response> {
  const assetResponse = await env.ASSETS.fetch(new URL('/index.html', request.url))

  if (!assetResponse.ok) {
    return new Response('SPA shell missing: run `pnpm --filter @afilmory/web build` first.', { status: 500 })
  }

  const { title, description, image, url, site, manifest, status } = options

  const configScript = `window.__CONFIG__ = ${toInlineJson(RUNTIME_CONFIG)}; window.__SITE_CONFIG__ = ${toInlineJson(site.siteConfig)};`
  const head = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`,
    `<meta name="description" content="${escapeHtml(description)}">`,
  ].join('')

  return (
    new HTMLRewriter()
      .on('script#config', {
        element(element) {
          // Script contents are raw text: passing `html: true` avoids turning
          // `&` into `&amp;`, which the browser would expose literally.
          element.setInnerContent(configScript, { html: true })
        },
      })
      // Only emitted by the static build; the Worker owns runtime config.
      .on('script#config-runtime', {
        element(element) {
          element.remove()
        },
      })
      .on('script#manifest', {
        element(element) {
          element.setInnerContent(`window.__MANIFEST__ = ${toInlineJson(manifest)};`, { html: true })
        },
      })
      .on('title', {
        element(element) {
          element.setInnerContent(title)
        },
      })
      .on('meta[name="apple-mobile-web-app-title"]', {
        element(element) {
          element.setAttribute('content', title)
        },
      })
      .on('#splash-screen h1', {
        element(element) {
          element.setInnerContent(title)
        },
      })
      .on('#splash-screen p', {
        element(element) {
          element.setInnerContent(description)
        },
      })
      .on('meta[name="description"]', {
        element(element) {
          element.remove()
        },
      })
      .on('meta[property^="og:"]', {
        element(element) {
          element.remove()
        },
      })
      .on('meta[name^="twitter:"]', {
        element(element) {
          element.remove()
        },
      })
      .on('meta[property^="twitter:"]', {
        element(element) {
          element.remove()
        },
      })
      .on('head', {
        element(element) {
          element.append(head, { html: true })
        },
      })
      .transform(
        new Response(assetResponse.body, {
          status,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'x-ssr': '1',
            // Never let the injected shell be cached by the CDN.
            'cache-control': 'no-store',
          },
        }),
      )
  )
}

export async function serveAppShell(request: Request, env: Env): Promise<Response> {
  const [manifest, site] = await Promise.all([loadManifest(env), loadOgSiteConfig(env)])
  const origin = new URL(request.url).origin

  return await renderShell(request, env, {
    status: 200,
    manifest,
    site,
    title: site.title || site.name,
    description: site.description,
    image: `${origin}/og/`,
    url: origin,
  })
}

interface ManifestPhoto {
  id: string
  title?: string
  description?: string
  thumbnailUrl?: string
  originalUrl?: string
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Photo detail shell — same HTML as `/`, but with the photo's Open Graph and Twitter meta tags. */
export async function servePhotoShell(request: Request, env: Env, photoId: string): Promise<Response> {
  const [manifest, site] = await Promise.all([loadManifest(env), loadOgSiteConfig(env)])
  const photos = (manifest.data ?? []) as ManifestPhoto[]
  const photo = photos.find((item) => item.id === photoId)
  const origin = new URL(request.url).origin

  if (!photo) {
    // Unknown photos still receive a working SPA shell so the client can render
    // its own not-found state; the status code signals the miss to crawlers.
    return await renderShell(request, env, {
      status: 404,
      manifest,
      site,
      title: site.title || site.name,
      description: site.description,
      image: `${origin}/og/`,
      url: `${origin}/photos/${encodeURIComponent(photoId)}`,
    })
  }

  return await renderShell(request, env, {
    status: 200,
    manifest,
    site,
    title: `${photo.title || photo.id} | ${site.title || site.name}`,
    description: photo.description || site.description,
    image: `${origin}/og/${encodeURIComponent(photo.id)}`,
    url: `${origin}/photos/${encodeURIComponent(photo.id)}`,
  })
}
