import { Body, Controller, Get, Post } from '@tsuki-hono/common'

import type { CreateOwnerInput } from './setup.service'
import { SetupService } from './setup.service'

@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get('status')
  async getStatus() {
    return await this.setup.getStatus()
  }

  @Post('owner')
  async createOwner(@Body() body: CreateOwnerInput) {
    return await this.setup.createOwner(body ?? {})
  }
}
