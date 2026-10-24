import { BizException, ErrorCode } from '@core/errors'
import { PlatformRoles } from '@core/guards/roles.decorator'
import { BypassResponseTransform } from '@core/interceptors/response-transform.decorator'
import { Body, ContextParam, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@tsuki-hono/common'
import type { Context } from 'hono'

import type { UploadCompleteInput, UploadIntentInput } from './personal-photo.service'
import { PersonalPhotoService } from './personal-photo.service'
import type { MultipartPart } from './photo-storage.service'

interface UpdateTagsBody {
  tags?: string[]
}

interface DeleteAssetsBody {
  ids?: string[]
  deleteFromStorage?: boolean
}

interface UploadCompleteBody extends UploadCompleteInput {
  parts?: MultipartPart[]
}

@Controller('photos')
@PlatformRoles('superadmin')
export class PersonalPhotoController {
  constructor(private readonly photos: PersonalPhotoService) {}

  @Get('assets')
  @BypassResponseTransform()
  async listAssets() {
    return await this.photos.listAssets()
  }

  @Get('assets/summary')
  async getSummary() {
    return await this.photos.getSummary()
  }

  @Post('upload-intent')
  @BypassResponseTransform()
  async createUploadIntent(@Body() body: UploadIntentInput) {
    return await this.photos.createUploadIntent(body)
  }

  @Put('upload/*')
  @BypassResponseTransform()
  async proxyUpload(@ContextParam() context: Context): Promise<Response> {
    return await this.photos.proxyUpload(context.req.raw)
  }

  @Post('upload-complete')
  @BypassResponseTransform()
  async completeUpload(@Body() body: UploadCompleteBody, @ContextParam() context: Context) {
    if (!body?.photoId) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'photoId is required' })
    }
    let waitUntil: ((promise: Promise<unknown>) => void) | undefined
    try {
      waitUntil = context.executionCtx.waitUntil.bind(context.executionCtx)
    } catch {
      // Local dev contexts do not always expose an ExecutionContext.
    }
    return await this.photos.completeUpload(
      { ...body, parts: body.parts ?? null, uploadId: body.uploadId ?? null },
      waitUntil,
    )
  }

  @Post('manifest/publish')
  async publishManifest() {
    await this.photos.publishManifest()
    return { published: true }
  }

  @Post('ai/reindex')
  async reindexAi(@Body() body: { limit?: number; force?: boolean }) {
    const limit = Number.isFinite(body?.limit) ? Math.min(Math.max(Number(body?.limit), 1), 50) : 10
    return await this.photos.reindexAi(limit, Boolean(body?.force))
  }

  @Post('assets/:id/ai/reindex')
  async reindexAiAsset(@Param('id') id: string) {
    return await this.photos.reindexAiAsset(id)
  }

  @Get('storage-url')
  async getStorageUrl(@Query() query: { key?: string }) {
    const key = query?.key?.trim()
    if (!key) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'key is required' })
    }
    return { url: await this.photos.getStorageUrl(key) }
  }

  @Delete('assets')
  async deleteAssets(@Body() body: DeleteAssetsBody) {
    const ids = Array.isArray(body?.ids) ? body.ids : []
    const changes = await this.photos.deleteAssets(ids, body?.deleteFromStorage === true)
    return { ids, deleted: true, deleteFromStorage: body?.deleteFromStorage === true, changes }
  }

  @Patch('assets/:id/tags')
  async updateAssetTags(@Param('id') id: string, @Body() body: UpdateTagsBody) {
    return await this.photos.updateAssetTags(id, body?.tags ?? [])
  }
}
