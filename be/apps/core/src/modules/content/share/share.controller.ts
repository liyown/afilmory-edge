import { SHARE_EMBED_SCRIPT } from '@afilmory/sdk'
import { BypassResponseTransform } from '@core/interceptors/response-transform.decorator'
import { ContextParam, Controller, Get } from '@tsuki-hono/common'
import type { Context } from 'hono'

import { ShareService } from './share.service'

const IFRAME_CACHE_CONTROL = 'public, max-age=60'
const EMBED_SCRIPT_CACHE_CONTROL = 'public, max-age=300, s-maxage=86400'

@Controller({ bypassGlobalPrefix: true })
@BypassResponseTransform()
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Get('/share/embed.js')
  getEmbedScript(): Response {
    return new Response(SHARE_EMBED_SCRIPT, {
      status: 200,
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': EMBED_SCRIPT_CACHE_CONTROL,
      },
    })
  }

  @Get('/share/iframe')
  async getIframe(@ContextParam() context: Context): Promise<Response> {
    const document = await this.shareService.renderIframe(
      {
        id: context.req.query('id'),
        ids: joinQueryValues(context.req.queries('ids')) ?? context.req.query('ids'),
        tag: context.req.query('tag'),
        limit: context.req.query('limit'),
        layout: context.req.query('layout'),
      },
      context.req.url,
    )

    return new Response(document.html, {
      status: document.status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': IFRAME_CACHE_CONTROL,
      },
    })
  }
}

function joinQueryValues(values: string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(',') : undefined
}
