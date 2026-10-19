// Serve the SPA shell with the live manifest/config injected before it
// reaches the browser.
//
// The SPA is built with AFILMORY_EMBED_MANIFEST=false, so `index.html` ships
// with empty `<script id="manifest">` / `<script id="config">` placeholders.

import { loadOgSiteConfig } from './og-site'

const MANIFEST_KEY = 'manifest.json'
const MANIFEST_CACHE_KEY = 'manifest:cache'
const MANIFEST_CACHE_TTL_SECONDS = 60

// The social features (session, comments, reactions) are served by this same
// Worker, so the gallery shell opts into them at runtime.
const INJECT_CONFIG_SCRIPT = `window.__CONFIG__ = ${JSON.stringify({
  useApi: false,
  useNext: false,
  useCloud: true,
})}; window.__SITE_CONFIG__ = {};`

type ManifestPayload = Record<string, unknown>

const EMPTY_MANIFEST: ManifestPayload = {
  version: 'v0',
  data: [],
  cameras: [],
  lenses: [],
}

export async function loadManifest(env: Pick<Env, 'CACHE' | 'PHOTOS'>): Promise<ManifestPayload> {
  const cached = await env.CACHE.get(MANIFEST_CACHE_KEY)
  if (cached) {
    return JSON.parse(cached) as ManifestPayload
  }

  const object = await env.PHOTOS.get(MANIFEST_KEY)
  if (!object) {
    return EMPTY_MANIFEST
  }

  const text = await object.text()
  await env.CACHE.put(MANIFEST_CACHE_KEY, text, { expirationTtl: MANIFEST_CACHE_TTL_SECONDS })

  return JSON.parse(text) as ManifestPayload
}

export async function serveAppShell(request: Request, env: Env): Promise<Response> {
  const assetResponse = await env.ASSETS.fetch(new URL('/index.html', request.url))

  if (!assetResponse.ok) {
    return new Response('SPA shell missing: run `pnpm --filter @afilmory/web build` first.', { status: 500 })
  }

  const manifest = await loadManifest(env)
  const site = await loadOgSiteConfig(env)
  const origin = new URL(request.url).origin
  const title = site.title || site.name
  const image = `${origin}/og/`
  const head = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(site.description)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta property="og:url" content="${escapeHtml(origin)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(site.description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`,
    `<meta name="description" content="${escapeHtml(site.description)}">`,
  ].join('')

  return new HTMLRewriter()
    .on('script#config', {
      element(element) {
        element.setInnerContent(INJECT_CONFIG_SCRIPT)
      },
    })
    .on('script#manifest', {
      element(element) {
        element.setInnerContent(`window.__MANIFEST__ = ${JSON.stringify(manifest)};`)
      },
    })
    .on('title', {
      element(element) {
        element.setInnerContent(title)
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
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'x-ssr': '1',
          // Never let the injected shell be cached by the CDN.
          'cache-control': 'no-store',
        },
      }),
    )
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
  const manifest = await loadManifest(env)
  const photos = (manifest.data ?? []) as ManifestPhoto[]
  const photo = photos.find(item => item.id === photoId)

  const assetResponse = await env.ASSETS.fetch(new URL('/index.html', request.url))
  if (!assetResponse.ok) {
    return new Response('SPA shell missing', { status: 500 })
  }

  if (!photo) {
    return new Response(assetResponse.body, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-ssr': '1' },
    })
  }

  const origin = new URL(request.url).origin
  const title = `${photo.title || photo.id} | Afilmory`
  const description = photo.description || ''
  const image = `${origin}/og/${encodeURIComponent(photo.id)}`
  const url = `${origin}/photos/${encodeURIComponent(photo.id)}`

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
  ].join('')

  return (
    new HTMLRewriter()
      .on('script#config', {
        element(element) {
          element.setInnerContent(INJECT_CONFIG_SCRIPT)
        },
      })
      .on('script#manifest', {
        element(element) {
          element.setInnerContent(`window.__MANIFEST__ = ${JSON.stringify(manifest)};`)
        },
      })
      .on('title', {
        element(element) {
          element.setInnerContent(title)
        },
      })
      // Drop the static defaults before appending the photo-specific ones.
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
      // The SPA build emits twitter tags as `property=`; strip both shapes.
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
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'x-ssr': '1',
            'cache-control': 'no-store',
          },
        }),
      )
  )
}
