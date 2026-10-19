import type { AfilmoryManifest, PhotoManifestItem } from '@afilmory/typing'
import type { SiteSettingService } from '@core/modules/configuration/site-setting/site-setting.service'
import type { ManifestService } from '@core/modules/content/manifest/manifest.service'
import { describe, expect, it, vi } from 'vitest'

import { ShareService } from './share.service'

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/afilmory'
  process.env.REDIS_URL ??= 'redis://localhost:6379'
  process.env.CONFIG_ENCRYPTION_KEY ??= 'test-config-encryption-key'
})

// The provider module validates the full server environment on import.
vi.mock('@core/database/database.provider', () => ({ DbAccessor: class DbAccessor {} }))

function createPhoto(overrides: Partial<PhotoManifestItem> & { id: string }): PhotoManifestItem {
  return {
    title: overrides.id,
    dateTaken: '2026-01-02T03:04:05.000Z',
    tags: [],
    description: '',
    originalUrl: `/media/${overrides.id}.jpg`,
    format: 'jpeg',
    thumbnailUrl: `/media/${overrides.id}-thumb.jpg`,
    thumbHash: null,
    width: 400,
    height: 300,
    aspectRatio: 4 / 3,
    s3Key: `photos/${overrides.id}.jpg`,
    lastModified: '2026-01-02T03:04:05.000Z',
    size: 1024,
    exif: null,
    keywords: [],
    regions: [],
    toneAnalysis: null,
    location: null,
    ...overrides,
  }
}

function createService(options: { photos: PhotoManifestItem[], url?: string, name?: string }) {
  const manifest: AfilmoryManifest = {
    version: 'v1',
    data: options.photos,
    cameras: [],
    lenses: [],
  }

  const manifestService = {
    getPhotosByIds: vi.fn(async (ids: string[]) =>
      ids
        .map(id => options.photos.find(photo => photo.id === id))
        .filter((photo): photo is PhotoManifestItem => Boolean(photo))),
    getManifest: vi.fn(async () => manifest),
  } as unknown as ManifestService

  const siteSettingService = {
    getSiteConfig: vi.fn(async () => ({
      name: options.name ?? 'Test Site',
      title: 'Test Site',
      description: '',
      url: options.url ?? 'https://gallery.test',
      accentColor: '#007bff',
      author: { name: '' },
    })),
  } as unknown as SiteSettingService

  return new ShareService(manifestService, siteSettingService)
}

describe('shareService#renderIframe', () => {
  it('renders a single photo with escaped content and gallery links', async () => {
    const photo = createPhoto({ id: 'photo-1', title: 'A <script>alert(1)</script>' })
    const service = createService({ photos: [photo] })

    const document = await service.renderIframe({ id: 'photo-1' }, 'https://gallery.test/share/iframe')

    expect(document.status).toBe(200)
    expect(document.html).toContain('af-photo')
    expect(document.html).toContain('aspect-ratio:400 / 300')
    expect(document.html).toContain('https://gallery.test/photos/photo-1')
    expect(document.html).toContain('A &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(document.html).not.toContain('<script>alert(1)</script>')
  })

  it('renders the requested photo order for id lists', async () => {
    const first = createPhoto({ id: 'first' })
    const second = createPhoto({ id: 'second' })
    const service = createService({ photos: [first, second] })

    const document = await service.renderIframe(
      { ids: 'second,first', layout: 'grid' },
      'https://gallery.test/share/iframe',
    )

    expect(document.status).toBe(200)
    expect(document.html).toContain('2 photos')
    expect(document.html).toContain('af-grid')
    expect(document.html.indexOf('/photos/second')).toBeLessThan(document.html.indexOf('/photos/first'))
  })

  it('filters by tag, applies the limit and renders an overflow tile', async () => {
    const photos = [
      createPhoto({ id: 'tagged-1', tags: ['landscape'] }),
      createPhoto({ id: 'tagged-2', tags: ['landscape'] }),
      createPhoto({ id: 'tagged-3', tags: ['landscape'] }),
      createPhoto({ id: 'untagged', tags: ['portrait'] }),
    ]
    const service = createService({ photos })

    const document = await service.renderIframe({ tag: 'landscape', limit: '2' }, 'https://gallery.test/share/iframe')

    expect(document.status).toBe(200)
    expect(document.html).toContain('af-tag-pill')
    expect(document.html).toContain('2 of 3')
    expect(document.html).toContain('+1 more')
    expect(document.html).toContain('/photos/tagged-1')
    expect(document.html).not.toContain('/photos/untagged')
    expect(document.html).toContain('https://gallery.test/?tags=landscape')
  })

  it('falls back to the request origin when the site url is not configured', async () => {
    const service = createService({ photos: [createPhoto({ id: 'photo-1' })], url: '' })

    const document = await service.renderIframe({ id: 'photo-1' }, 'http://localhost:5173/share/iframe?id=photo-1')

    expect(document.status).toBe(200)
    expect(document.html).toContain('http://localhost:5173/photos/photo-1')
  })

  it('returns a 404 document for unknown photos, id lists and tags', async () => {
    const service = createService({ photos: [createPhoto({ id: 'photo-1' })] })

    await expect(service.renderIframe({ id: 'missing' }, 'https://gallery.test/share/iframe')).resolves.toMatchObject({
      status: 404,
    })
    await expect(service.renderIframe({ ids: 'missing' }, 'https://gallery.test/share/iframe')).resolves.toMatchObject({
      status: 404,
    })
    await expect(service.renderIframe({ tag: 'missing' }, 'https://gallery.test/share/iframe')).resolves.toMatchObject({
      status: 404,
    })
    await expect(service.renderIframe({}, 'https://gallery.test/share/iframe')).resolves.toMatchObject({
      status: 404,
    })
  })
})
