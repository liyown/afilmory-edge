import { env } from '@afilmory/env'
import { SystemSettingService } from '@core/modules/configuration/system-setting/system-setting.service'
import { injectable } from 'tsyringe'

export interface SocialProviderOptions {
  clientId: string
  clientSecret: string
}

export interface SocialProvidersConfig {
  google?: SocialProviderOptions
  github?: SocialProviderOptions
}

export interface AppleAuthOptions {
  clientId: string
  keyId: string
  privateKey: string
  teamId: string
}

export interface AuthModuleOptions {
  prefix: string
  useDrizzle: boolean
  socialProviders: SocialProvidersConfig
  apple?: AppleAuthOptions
  oauthGatewayUrl: string | null
}

@injectable()
export class AuthConfig {
  constructor(private readonly systemSettings: SystemSettingService) {}

  async getOptions(): Promise<AuthModuleOptions> {
    const prefix = '/auth'
    const { socialProviders, oauthGatewayUrl } = await this.systemSettings.getAuthModuleConfig()
    const settings = await this.systemSettings.getSettings()

    const clientId = settings.oauthAppleWebClientId ?? env.APPLE_WEB_CLIENT_ID ?? null
    const teamId = settings.oauthAppleTeamId ?? env.APPLE_TEAM_ID ?? null
    const keyId = settings.oauthAppleKeyId ?? env.APPLE_KEY_ID ?? null
    const privateKey = env.APPLE_PRIVATE_KEY ?? null
    const apple
      = clientId && teamId && keyId && privateKey
        ? {
            clientId,
            keyId,
            privateKey,
            teamId,
          }
        : undefined

    return {
      prefix,
      useDrizzle: true,
      socialProviders,
      apple,
      oauthGatewayUrl,
    }
  }
}
