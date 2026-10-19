import { BizException, ErrorCode } from '@core/errors'
import { TenantRoles } from '@core/guards/roles.decorator'
import { BypassResponseTransform } from '@core/interceptors/response-transform.decorator'
import { Body, ContextParam, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@tsuki-hono/common'
import type { Context } from 'hono'

import type { UploadCompleteInput, UploadIntentInput } from './personal-photo.service'
import { PersonalPhotoService } from './personal-photo.service'
import type { MultipartPart } from './r2-upload.service'

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
@TenantRoles('admin')
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

  @Post('upload-complete')
  @BypassResponseTransform()
  async completeUpload(@Body() body: UploadCompleteBody) {
    if (!body?.photoId) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'photoId is required' })
    }
    return await this.photos.completeUpload({ ...body, parts: body.parts ?? null, uploadId: body.uploadId ?? null })
  }

  // Fallback used when R2 S3 credentials are absent: the browser PUTs the
  // bytes to the Worker, which forwards them to the R2 binding.
  @Put('upload-content')
  @BypassResponseTransform()
  async uploadContent(@ContextParam() context: Context): Promise<Response> {
    const key = context.req.query('key')
    if (!key) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'key is required' })
    }

    const body = await context.req.arrayBuffer()
    await this.photos.putUploadedObject(key, body, context.req.header('content-type'))
    return new Response(null, { status: 204 })
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
