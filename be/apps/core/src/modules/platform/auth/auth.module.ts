import { DatabaseModule } from '@core/database/database.module'
import { SettingModule } from '@core/modules/configuration/setting/setting.module'
import { SystemSettingModule } from '@core/modules/configuration/system-setting/system-setting.module'
import { Module } from '@tsuki-hono/common'

import { AppleClientSecretService } from './apple-client-secret.service'
import { AuthConfig } from './auth.config'
import { AuthController } from './auth.controller'
import { AuthProvider } from './auth.provider'

@Module({
  imports: [DatabaseModule, SystemSettingModule, SettingModule],
  controllers: [AuthController],
  providers: [AuthProvider, AuthConfig, AppleClientSecretService],
})
export class AuthModule {}
