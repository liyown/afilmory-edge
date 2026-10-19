import { BizException, ErrorCode } from '@core/errors'
import { Controller, Get, Query } from '@tsuki-hono/common'

import { PhotoSearchService } from './photo-search.service'

@Controller('photos')
export class PhotoSearchController {
  constructor(private readonly searchService: PhotoSearchService) {}

  @Get('search')
  async search(@Query() query: { q?: string; limit?: string }) {
    const term = query.q?.trim() ?? ''
    if (term.length === 0 || term.length > 200) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'q must be between 1 and 200 characters' })
    }
    const requestedLimit = Number.parseInt(query.limit ?? '20', 10)
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20
    return await this.searchService.search(term, limit)
  }
}
