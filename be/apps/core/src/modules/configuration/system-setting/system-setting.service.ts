import { authUsers } from '@afilmory/db'
import { DbAccessor } from '@core/database/database.provider'
import { BizException, ErrorCode } from '@core/errors'
import { normalizeNullableString } from '@core/helpers/normalize.helper'
import type { SocialProvidersConfig } from '@core/modules/platform/auth/auth.config'
import { sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'
import type { ZodType } from 'zod'

import { getUiSchemaTranslator } from '../../ui/ui-schema/ui-schema.i18n'
import type { SystemSettingDbField } from './system-setting.constants'
import { SYSTEM_SETTING_DEFINITIONS, SYSTEM_SETTING_KEYS } from './system-setting.constants'
import { SystemSettingStore } from './system-setting.store.service'
import type {
  SystemSettingOverview,
  SystemSettings,
  SystemSettingStats,
  SystemSettingValueMap,
  UpdateSystemSettingsInput,
} from './system-setting.types'
import { createSystemSettingUiSchema } from './system-setting.ui-schema'

const TRAILING_SLASHES_REGEX = /\/+$/

@injectable()
export class SystemSettingService {
  constructor(
    private readonly systemSettingStore: SystemSettingStore,
    private readonly dbAccessor: DbAccessor,
  ) {}

  async getSettings(): Promise<SystemSettings> {
    const rawValues = await this.systemSettingStore.getMany(SYSTEM_SETTING_KEYS)

    const allowRegistration = this.parseSetting(
      rawValues[SYSTEM_SETTING_DEFINITIONS.allowRegistration.key],
      SYSTEM_SETTING_DEFINITIONS.allowRegistration.schema,
      SYSTEM_SETTING_DEFINITIONS.allowRegistration.defaultValue,
    )

    const maxRegistrableUsers = this.parseSetting(
      rawValues[SYSTEM_SETTING_DEFINITIONS.maxRegistrableUsers.key],
      SYSTEM_SETTING_DEFINITIONS.maxRegistrableUsers.schema,
      SYSTEM_SETTING_DEFINITIONS.maxRegistrableUsers.defaultValue,
    )

    const maxPhotoUploadSizeMb = this.parseSetting(
      rawValues[SYSTEM_SETTING_DEFINITIONS.maxPhotoUploadSizeMb.key],
      SYSTEM_SETTING_DEFINITIONS.maxPhotoUploadSizeMb.schema,
      SYSTEM_SETTING_DEFINITIONS.maxPhotoUploadSizeMb.defaultValue,
    )

    const maxPhotoLibraryItems = this.parseSetting(
      rawValues[SYSTEM_SETTING_DEFINITIONS.maxPhotoLibraryItems.key],
      SYSTEM_SETTING_DEFINITIONS.maxPhotoLibraryItems.schema,
      SYSTEM_SETTING_DEFINITIONS.maxPhotoLibraryItems.defaultValue,
    )

    const localProviderEnabled = this.parseSetting(
      rawValues[SYSTEM_SETTING_DEFINITIONS.localProviderEnabled.key],
      SYSTEM_SETTING_DEFINITIONS.localProviderEnabled.schema,
      SYSTEM_SETTING_DEFINITIONS.localProviderEnabled.defaultValue,
    )

    const oauthGatewayUrl = this.normalizeGatewayUrl(
      this.parseSetting(
        rawValues[SYSTEM_SETTING_DEFINITIONS.oauthGatewayUrl.key],
        SYSTEM_SETTING_DEFINITIONS.oauthGatewayUrl.schema,
        SYSTEM_SETTING_DEFINITIONS.oauthGatewayUrl.defaultValue,
      ),
    )

    const oauthGoogleClientId = this.parseSetting(
      rawValues[SYSTEM_SETTING_DEFINITIONS.oauthGoogleClientId.key],
      SYSTEM_SETTING_DEFINITIONS.oauthGoogleClientId.schema,
      SYSTEM_SETTING_DEFINITIONS.oauthGoogleClientId.defaultValue,
    )
    const oauthGoogleClientSecret = this.parseSetting(
      rawValues[SYSTEM_SETTING_DEFINITIONS.oauthGoogleClientSecret.key],
      SYSTEM_SETTING_DEFINITIONS.oauthGoogleClientSecret.schema,
      SYSTEM_SETTING_DEFINITIONS.oauthGoogleClientSecret.defaultValue,
    )
    const oauthGithubClientId = this.parseSetting(
      rawValues[SYSTEM_SETTING_DEFINITIONS.oauthGithubClientId.key],
      SYSTEM_SETTING_DEFINITIONS.oauthGithubClientId.schema,
      SYSTEM_SETTING_DEFINITIONS.oauthGithubClientId.defaultValue,
    )
    const oauthGithubClientSecret = this.parseSetting(
      rawValues[SYSTEM_SETTING_DEFINITIONS.oauthGithubClientSecret.key],
      SYSTEM_SETTING_DEFINITIONS.oauthGithubClientSecret.schema,
      SYSTEM_SETTING_DEFINITIONS.oauthGithubClientSecret.defaultValue,
    )
    const oauthAppleWebClientId = this.parseSetting(
      rawValues[SYSTEM_SETTING_DEFINITIONS.oauthAppleWebClientId.key],
      SYSTEM_SETTING_DEFINITIONS.oauthAppleWebClientId.schema,
      SYSTEM_SETTING_DEFINITIONS.oauthAppleWebClientId.defaultValue,
    )
    const oauthAppleTeamId = this.parseSetting(
      rawValues[SYSTEM_SETTING_DEFINITIONS.oauthAppleTeamId.key],
      SYSTEM_SETTING_DEFINITIONS.oauthAppleTeamId.schema,
      SYSTEM_SETTING_DEFINITIONS.oauthAppleTeamId.defaultValue,
    )
    const oauthAppleKeyId = this.parseSetting(
      rawValues[SYSTEM_SETTING_DEFINITIONS.oauthAppleKeyId.key],
      SYSTEM_SETTING_DEFINITIONS.oauthAppleKeyId.schema,
      SYSTEM_SETTING_DEFINITIONS.oauthAppleKeyId.defaultValue,
    )
    return {
      allowRegistration,
      maxRegistrableUsers,
      maxPhotoUploadSizeMb,
      maxPhotoLibraryItems,
      localProviderEnabled,
      oauthGatewayUrl,
      oauthGoogleClientId,
      oauthGoogleClientSecret,
      oauthGithubClientId,
      oauthGithubClientSecret,
      oauthAppleWebClientId,
      oauthAppleTeamId,
      oauthAppleKeyId,
    }
  }

  async getOverview(): Promise<SystemSettingOverview> {
    const settings = await this.getSettings()
    const totalUsers = await this.getTotalUserCount()
    const stats = this.buildStats(settings, totalUsers)
    const { t } = getUiSchemaTranslator()
    return {
      schema: createSystemSettingUiSchema(t),
      values: this.buildValueMap(settings),
      stats,
    }
  }

  async updateSettings(patch: UpdateSystemSettingsInput): Promise<SystemSettings> {
    if (!patch || Object.values(patch).every(value => value === undefined)) {
      return await this.getSettings()
    }

    const current = await this.getSettings()
    const updates: Array<{ field: SystemSettingDbField, value: unknown }> = []

    const enqueueUpdate = <K extends SystemSettingDbField>(
      field: K,
      value: unknown,
      currentValue?: SystemSettings[K],
    ) => {
      updates.push({ field, value })
      if (currentValue !== undefined) {
        ;(current as unknown as Record<string, unknown>)[field] = currentValue
      }
      else {
        ;(current as unknown as Record<string, unknown>)[field] = value
      }
    }

    if (patch.allowRegistration !== undefined && patch.allowRegistration !== current.allowRegistration) {
      enqueueUpdate('allowRegistration', patch.allowRegistration)
    }

    if (patch.localProviderEnabled !== undefined && patch.localProviderEnabled !== current.localProviderEnabled) {
      enqueueUpdate('localProviderEnabled', patch.localProviderEnabled)
    }

    if (patch.maxRegistrableUsers !== undefined) {
      const normalized = patch.maxRegistrableUsers === null ? null : Math.max(0, Math.trunc(patch.maxRegistrableUsers))
      if (normalized !== current.maxRegistrableUsers) {
        if (normalized !== null) {
          const totalUsers = await this.getTotalUserCount()
          if (normalized < totalUsers) {
            throw new BizException(ErrorCode.COMMON_BAD_REQUEST, {
              message: '最大可注册用户数不能小于当前用户总数',
            })
          }
        }

        enqueueUpdate('maxRegistrableUsers', normalized)
      }
    }

    if (patch.maxPhotoUploadSizeMb !== undefined && patch.maxPhotoUploadSizeMb !== current.maxPhotoUploadSizeMb) {
      const normalized
        = patch.maxPhotoUploadSizeMb === null ? null : Math.max(1, Math.trunc(patch.maxPhotoUploadSizeMb))
      enqueueUpdate('maxPhotoUploadSizeMb', normalized)
    }

    if (patch.maxPhotoLibraryItems !== undefined && patch.maxPhotoLibraryItems !== current.maxPhotoLibraryItems) {
      const normalized
        = patch.maxPhotoLibraryItems === null ? null : Math.max(0, Math.trunc(patch.maxPhotoLibraryItems))
      enqueueUpdate('maxPhotoLibraryItems', normalized)
    }

    if (patch.oauthGatewayUrl !== undefined) {
      const sanitized = this.normalizeGatewayUrl(patch.oauthGatewayUrl)
      if (sanitized !== current.oauthGatewayUrl) {
        enqueueUpdate('oauthGatewayUrl', sanitized)
      }
    }

    if (patch.oauthGoogleClientId !== undefined) {
      const sanitized = normalizeNullableString(patch.oauthGoogleClientId)
      if (sanitized !== current.oauthGoogleClientId) {
        enqueueUpdate('oauthGoogleClientId', sanitized)
      }
    }

    if (patch.oauthGoogleClientSecret !== undefined) {
      const sanitized = normalizeNullableString(patch.oauthGoogleClientSecret)
      if (sanitized !== current.oauthGoogleClientSecret) {
        enqueueUpdate('oauthGoogleClientSecret', sanitized)
      }
    }

    if (patch.oauthGithubClientId !== undefined) {
      const sanitized = normalizeNullableString(patch.oauthGithubClientId)
      if (sanitized !== current.oauthGithubClientId) {
        enqueueUpdate('oauthGithubClientId', sanitized)
      }
    }

    if (patch.oauthGithubClientSecret !== undefined) {
      const sanitized = normalizeNullableString(patch.oauthGithubClientSecret)
      if (sanitized !== current.oauthGithubClientSecret) {
        enqueueUpdate('oauthGithubClientSecret', sanitized)
      }
    }

    if (patch.oauthAppleWebClientId !== undefined) {
      const sanitized = normalizeNullableString(patch.oauthAppleWebClientId)
      if (sanitized !== current.oauthAppleWebClientId) {
        enqueueUpdate('oauthAppleWebClientId', sanitized)
      }
    }

    if (patch.oauthAppleTeamId !== undefined) {
      const sanitized = normalizeNullableString(patch.oauthAppleTeamId)
      if (sanitized !== current.oauthAppleTeamId) {
        enqueueUpdate('oauthAppleTeamId', sanitized)
      }
    }

    if (patch.oauthAppleKeyId !== undefined) {
      const sanitized = normalizeNullableString(patch.oauthAppleKeyId)
      if (sanitized !== current.oauthAppleKeyId) {
        enqueueUpdate('oauthAppleKeyId', sanitized)
      }
    }

    if (updates.length === 0) {
      return current
    }

    await this.systemSettingStore.setMany(
      updates.map((entry) => {
        const definition = SYSTEM_SETTING_DEFINITIONS[entry.field]
        return {
          key: definition.key,
          value: (entry.value ?? null) as unknown,
          options: { isSensitive: definition.isSensitive ?? false },
        }
      }),
    )

    return current
  }

  private buildValueMap(settings: SystemSettings): SystemSettingValueMap {
    const map = {} as SystemSettingValueMap

    ;(Object.keys(SYSTEM_SETTING_DEFINITIONS) as SystemSettingDbField[]).forEach((field) => {
      ;(map as Record<string, unknown>)[field] = settings[field]
    })

    return map
  }

  async ensureRegistrationAllowed(): Promise<void> {
    const settings = await this.getSettings()

    if (!settings.allowRegistration) {
      throw new BizException(ErrorCode.AUTH_FORBIDDEN, {
        message: '当前已关闭用户注册，请联系管理员获取访问权限。',
      })
    }

    if (settings.maxRegistrableUsers === null) {
      return
    }

    const totalUsers = await this.getTotalUserCount()
    if (totalUsers >= settings.maxRegistrableUsers) {
      throw new BizException(ErrorCode.AUTH_FORBIDDEN, {
        message: '用户注册数量已达到上限，请联系管理员。',
      })
    }
  }

  async getAuthModuleConfig(): Promise<{
    socialProviders: SocialProvidersConfig
    oauthGatewayUrl: string | null
  }> {
    const settings = await this.getSettings()
    return {
      socialProviders: this.buildSocialProviders(settings),
      oauthGatewayUrl: settings.oauthGatewayUrl,
    }
  }

  private parseSetting<T>(raw: unknown, schema: ZodType<T>, defaultValue: T): T {
    if (raw === null || raw === undefined) {
      return defaultValue
    }

    const parsed = schema.safeParse(raw)
    return parsed.success ? parsed.data : defaultValue
  }

  private buildSocialProviders(settings: SystemSettings): SocialProvidersConfig {
    const providers: SocialProvidersConfig = {}

    if (settings.oauthGoogleClientId && settings.oauthGoogleClientSecret) {
      providers.google = {
        clientId: settings.oauthGoogleClientId,
        clientSecret: settings.oauthGoogleClientSecret,
      }
    }

    if (settings.oauthGithubClientId && settings.oauthGithubClientSecret) {
      providers.github = {
        clientId: settings.oauthGithubClientId,
        clientSecret: settings.oauthGithubClientSecret,
      }
    }

    return providers
  }

  private normalizeGatewayUrl(value: string | null | undefined): string | null {
    if (value === undefined || value === null) {
      return null
    }

    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return null
    }

    try {
      const url = new URL(trimmed)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return null
      }

      const normalizedPath = url.pathname === '/' ? '' : url.pathname.replace(TRAILING_SLASHES_REGEX, '')
      return `${url.origin}${normalizedPath}`
    }
    catch {
      return null
    }
  }

  private buildStats(settings: SystemSettings, totalUsers: number): SystemSettingStats {
    const remaining
      = settings.maxRegistrableUsers === null ? null : Math.max(settings.maxRegistrableUsers - totalUsers, 0)

    return {
      totalUsers,
      registrationsRemaining: remaining,
    }
  }

  private async getTotalUserCount(): Promise<number> {
    const [row] = await this.dbAccessor
      .get()
      .select({ total: sql<number>`count(*)` })
      .from(authUsers)
    return typeof row?.total === 'number' ? row.total : Number(row?.total ?? 0)
  }
}
