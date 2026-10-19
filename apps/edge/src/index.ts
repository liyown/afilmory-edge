import { env } from 'cloudflare:workers'

import { getCoreApp } from './core-app'
import { getDatabaseHealthApp } from './core-database'
import { runDecoratorSpike } from './decorator-spike'
import { loadManifest, serveAppShell, servePhotoShell } from './html'
import { renderOgImage } from './og'

// T0.3: prove every planned binding is reachable from the Worker in local mode.
async function runBindingSpike() {
  const result: Record<string, unknown> = {}

  try {
    const row = await env.DB.prepare('select 1 as ok').first()
    result.d1 = row
  }
  catch (error) {
    result.d1 = { error: error instanceof Error ? error.message : String(error) }
  }

  try {
    const key = `spike/${Date.now()}.txt`
    await env.PHOTOS.put(key, 'hello-r2')
    const object = await env.PHOTOS.get(key)
    result.r2 = { key, body: object ? await object.text() : null }
  }
  catch (error) {
    result.r2 = { error: error instanceof Error ? error.message : String(error) }
  }

  try {
    await env.CACHE.put('spike:kv', 'hello-kv', { expirationTtl: 60 })
    result.kv = { value: await env.CACHE.get('spike:kv') }
  }
  catch (error) {
    result.kv = { error: error instanceof Error ? error.message : String(error) }
  }

  return result
}

/** Dev-only helper: drop a tiny manifest into R2 so injection can be verified. */
async function seedManifest() {
  const manifest = {
    version: 'v0',
    data: [
      {
        id: 'spike-photo',
        title: 'Spike photo',
        description: 'A seeded photo used to verify SSR meta injection.',
        thumbnailUrl: '/favicon-32x32.png',
        tags: ['spike'],
      },
    ],
    cameras: [],
    lenses: [],
  }
  await env.PHOTOS.put('manifest.json', JSON.stringify(manifest))
  await env.CACHE.delete('manifest:cache')
  return manifest
}

export default {
  async fetch(request: Request) {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        worker: 'afilmory-edge',
        world: env.WORLD,
        ts: new Date().toISOString(),
      })
    }

    // T0.2 gate: proves tsyringe can resolve constructor injection inside workerd
    // (i.e. SWC emitted design:paramtypes and reflect-metadata survived the bundle).
    if (url.pathname === '/api/spike/decorators') {
      return Response.json(runDecoratorSpike())
    }

    // T2.2: core DI graph running against the D1 binding.
    if (url.pathname === '/api/health') {
      const app = await getDatabaseHealthApp()
      return app.getInstance().fetch(request)
    }

    // T3.1: better-auth (SQLite/D1 adapter) and the local session routes.
    if (
      url.pathname === '/api/auth'
      || url.pathname.startsWith('/api/auth/')
      || url.pathname === '/api/mobile-auth'
      || url.pathname.startsWith('/api/mobile-auth/')
    ) {
      const app = await getCoreApp()
      return app.getInstance().fetch(request)
    }

    if (url.pathname === '/api/spike/bindings') {
      return Response.json(await runBindingSpike())
    }

    if (url.pathname === '/api/spike/seed-manifest') {
      return Response.json(await seedManifest())
    }

    if (url.pathname === '/api/manifest') {
      return Response.json(await loadManifest(env))
    }

    // T1.3: HTML shell with injected manifest (only for the routes listed in
    // `runWorkerFirst`; everything else is served as a static asset).
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveAppShell(request, env)
    }

    // T1.4: photo detail shell with og/twitter meta.
    const photoMatch = /^\/photos\/([^/]+)\/?$/.exec(url.pathname)
    if (photoMatch) {
      return servePhotoShell(request, env, decodeURIComponent(photoMatch[1]))
    }

    // Serve photo bytes straight from R2 (originals + thumbnails).
    const mediaMatch = /^\/media\/(.+)$/.exec(url.pathname)
    if (mediaMatch) {
      const key = decodeURIComponent(mediaMatch[1])
      const object = await env.PHOTOS.get(key)
      if (!object) {
        return new Response('Not Found', { status: 404 })
      }
      const headers = new Headers()
      object.writeHttpMetadata(headers)
      headers.set('etag', object.httpEtag)
      headers.set('cache-control', 'public, max-age=31536000, immutable')
      return new Response(object.body, { headers })
    }

    // T1.5: OG image for a photo.
    const ogMatch = /^\/og\/([^/]+)\/?$/.exec(url.pathname)
    if (ogMatch) {
      const manifest = await loadManifest(env)
      const photoId = decodeURIComponent(ogMatch[1])
      const photo = ((manifest.data ?? []) as Array<{ id: string, title?: string, description?: string }>).find(
        item => item.id === photoId,
      )

      if (!photo) {
        return new Response('Not Found', { status: 404 })
      }

      const image = renderOgImage(photo)
      const headers = new Headers(image.headers)
      headers.set('cache-control', 'public, max-age=86400')
      return new Response(image.body, { status: image.status, headers })
    }

    return new Response(`Hello ${env.WORLD}!`, {
      headers: { 'content-type': 'text/plain;charset=utf-8' },
    })
  },
} satisfies ExportedHandler
