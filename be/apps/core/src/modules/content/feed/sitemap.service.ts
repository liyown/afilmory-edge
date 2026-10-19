import type { PhotoManifestItem } from '@afilmory/typing'
import { SiteSettingService } from '@core/modules/configuration/site-setting/site-setting.service'
import { ManifestService } from '@core/modules/content/manifest/manifest.service'
import { CacheService } from '@core/modules/infrastructure/cache/cache.service'
import { HttpContext } from '@tsuki-hono/common'
import type { Context } from 'hono'
import { injectable } from 'tsyringe'

const CACHE_KEY = 'core:sitemap:v1'
const CACHE_TTL_SECONDS = 300
const TRAILING_SLASHES = /\/+$/

export interface SitemapDocument {
  xml: string
  generatedAt: string
}

@injectable()
export class SitemapService {
  constructor(
    private readonly cacheService: CacheService,
    private readonly siteSettingService: SiteSettingService,
    private readonly manifestService: ManifestService,
  ) {}

  async getSitemapDocument(): Promise<SitemapDocument> {
    return await this.cacheService.rememberJson(CACHE_KEY, async () => await this.buildSitemapDocument(), {
      ttlSeconds: CACHE_TTL_SECONDS,
    })
  }

  private async buildSitemapDocument(): Promise<SitemapDocument> {
    const [manifest, siteConfig] = await Promise.all([
      this.manifestService.getManifest(),
      this.siteSettingService.getSiteConfig(),
    ])

    const baseUrl = this.resolveBaseUrl(siteConfig.url)
    const generatedAt = new Date().toISOString()

    return {
      xml: this.renderSitemap(manifest.data, baseUrl, generatedAt),
      generatedAt,
    }
  }

  private renderSitemap(photos: readonly PhotoManifestItem[], baseUrl: string, generatedAt: string): string {
    const urls = [
      this.renderUrl(`${baseUrl}/`, generatedAt, 'daily', '1.0'),
      ...photos.map(photo =>
        this.renderUrl(
          `${baseUrl}/photos/${encodeURIComponent(photo.id)}`,
          this.resolveLastModified(photo) ?? generatedAt,
          'monthly',
          '0.8',
        )),
    ]

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`
  }

  private renderUrl(loc: string, lastmod: string, changefreq: string, priority: string): string {
    return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
  }

  private resolveLastModified(photo: PhotoManifestItem): string | null {
    const candidate = photo.lastModified ?? photo.dateTaken
    if (!candidate) {
      return null
    }
    const timestamp = Date.parse(candidate)
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
  }

  private resolveBaseUrl(candidate?: string | null): string {
    const normalized = candidate?.trim().replace(TRAILING_SLASHES, '')
    if (normalized) {
      return normalized
    }

    const context = this.getHttpContext()
    if (context) {
      try {
        return new URL(context.req.url).origin
      }
      catch {
        // Fall through to the placeholder below.
      }
    }

    return 'http://localhost'
  }

  private getHttpContext(): Context | null {
    try {
      return (HttpContext.getValue('hono') as Context | undefined) ?? null
    }
    catch {
      return null
    }
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}
