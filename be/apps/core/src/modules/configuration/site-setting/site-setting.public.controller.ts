import { BypassResponseTransform } from '@core/interceptors/response-transform.decorator'
import { Controller, Get } from '@tsuki-hono/common'

import { SiteSettingService } from './site-setting.service'

@Controller('public/site-settings')
export class SiteSettingPublicController {
  constructor(private readonly siteSettingService: SiteSettingService) {}

  @Get('/welcome-schema')
  @BypassResponseTransform()
  async getWelcomeSchema() {
    return await this.siteSettingService.getOnboardingUiSchema()
  }
}
