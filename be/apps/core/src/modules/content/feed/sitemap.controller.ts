import { Controller, Get } from '@tsuki-hono/common'

import { SitemapService } from './sitemap.service'

@Controller({ bypassGlobalPrefix: true })
export class SitemapController {
  constructor(private readonly sitemapService: SitemapService) {}

  @Get('/sitemap.xml')
  async getSitemap(): Promise<Response> {
    const document = await this.sitemapService.getSitemapDocument()

    return new Response(document.xml, {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    })
  }
}
