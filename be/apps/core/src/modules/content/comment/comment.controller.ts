import { RequireAuth, TenantRoles } from '@core/guards/roles.decorator'
import { Body, ContextParam, Controller, Delete, Get, Param, Post, Query } from '@tsuki-hono/common'
import type { Context } from 'hono'

import {
  CommentReactionDto,
  CreateCommentDto,
  GetCommentCountQueryDto,
  ListAllCommentsQueryDto,
  ListCommentsQueryDto,
} from './comment.dto'
import { CommentService } from './comment.service'

@Controller('comments')
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @Post('/')
  @RequireAuth()
  async createComment(@ContextParam() context: Context, @Body() body: CreateCommentDto) {
    return await this.commentService.createComment(body, context)
  }

  @Get('/count')
  async getCommentCount(@Query() query: GetCommentCountQueryDto) {
    return await this.commentService.getCommentCount(query)
  }

  @Get('/')
  async listComments(@Query() query: ListCommentsQueryDto) {
    return await this.commentService.listComments(query)
  }

  @Get('/all')
  @TenantRoles('admin')
  async listAllComments(@Query() query: ListAllCommentsQueryDto) {
    return await this.commentService.listAllComments(query)
  }

  @Post('/:id/reactions')
  @RequireAuth()
  async react(@Param('id') commentId: string, @Body() body: CommentReactionDto) {
    return await this.commentService.toggleReaction(commentId, body)
  }

  @Delete('/:id')
  @RequireAuth()
  async deleteComment(@Param('id') commentId: string) {
    await this.commentService.softDelete(commentId)
    return { id: commentId, deleted: true }
  }
}
