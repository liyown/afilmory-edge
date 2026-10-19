import type { UiSchema } from '@core/modules/ui/ui-schema/ui-schema.type'

import type { SystemSettingDbField, SystemSettingField, SystemSettingKey } from './system-setting.constants'

export interface SystemSettings {
  allowRegistration: boolean
  maxRegistrableUsers: number | null
  maxPhotoUploadSizeMb: number | null
  maxPhotoLibraryItems: number | null
  localProviderEnabled: boolean
  oauthGatewayUrl: string | null
  oauthGoogleClientId: string | null
  oauthGoogleClientSecret: string | null
  oauthGithubClientId: string | null
  oauthGithubClientSecret: string | null
  oauthAppleWebClientId: string | null
  oauthAppleTeamId: string | null
  oauthAppleKeyId: string | null
}

export type SystemSettingValueMap = {
  [K in SystemSettingDbField]: SystemSettings[K]
}

export interface SystemSettingStats {
  totalUsers: number
  registrationsRemaining: number | null
}

export interface SystemSettingOverview {
  schema: UiSchema<SystemSettingField>
  values: SystemSettingValueMap
  stats: SystemSettingStats
}

export type UpdateSystemSettingsInput = Partial<SystemSettings>

export { type SystemSettingField } from './system-setting.constants'

declare module '@core/modules/infrastructure/event/events' {
  interface Events {
    'system.setting.updated': { key: SystemSettingKey, value: unknown }
  }
}
