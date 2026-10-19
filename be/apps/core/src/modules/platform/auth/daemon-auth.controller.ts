import { BizException, ErrorCode } from '@core/errors'
import { PlatformRoles } from '@core/guards/roles.decorator'
import { Body, Controller, Delete, Get, HttpContext, Param, Post } from '@tsuki-hono/common'

import type { AuthorizeInput, ExchangeTokenInput } from './daemon-auth.service'
import { DaemonAuthService } from './daemon-auth.service'

@Controller('daemon')
export class DaemonAuthController {
  constructor(private readonly daemonAuth: DaemonAuthService) {}

  @Post('authorize')
  @PlatformRoles('superadmin')
  async authorize(@Body() body: AuthorizeInput) {
    return await this.daemonAuth.authorize(this.currentUserId(), body ?? {})
  }

  @Post('token')
  async exchange(@Body() body: ExchangeTokenInput) {
    return await this.daemonAuth.exchange(body ?? {})
  }

  @Get('tokens')
  @PlatformRoles('superadmin')
  async listTokens() {
    return { tokens: await this.daemonAuth.listTokens(this.currentUserId()) }
  }

  @Delete('tokens/:id')
  @PlatformRoles('superadmin')
  async revokeToken(@Param('id') id: string) {
    return await this.daemonAuth.revokeToken(this.currentUserId(), id)
  }

  private currentUserId(): string {
    const user = HttpContext.getValue('auth')?.user
    if (!user?.id) {
      throw new BizException(ErrorCode.AUTH_UNAUTHORIZED)
    }
    return user.id
  }
}
