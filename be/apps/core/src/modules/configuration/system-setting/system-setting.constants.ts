import { DEFAULT_BASE_DOMAIN } from '@afilmory/utils'
import { z } from 'zod'

const nonEmptyString = z.string().trim().min(1)
const nullableNonEmptyString = nonEmptyString.nullable()
const nullableUrl = z.string().trim().url({ message: '必须是有效的 URL' }).nullable()
const nullableHttpUrl = nullableUrl.refine(
  value => value === null || value.startsWith('http://') || value.startsWith('https://'),
  { message: '只支持 http 或 https 协议' },
)

export const SYSTEM_SETTING_DEFINITIONS = {
  allowRegistration: {
    key: 'system.registration.allow',
    schema: z.boolean(),
    defaultValue: true,
    isSensitive: false,
  },
  maxRegistrableUsers: {
    key: 'system.registration.maxUsers',
    schema: z.number().int().min(0).nullable(),
    defaultValue: null as number | null,
    isSensitive: false,
  },
  maxPhotoUploadSizeMb: {
    key: 'system.photo.upload.maxSizeMb',
    schema: z.number().int().positive().nullable(),
    defaultValue: null as number | null,
    isSensitive: false,
  },
  maxPhotoLibraryItems: {
    key: 'system.photo.library.maxItems',
    schema: z.number().int().min(0).nullable(),
    defaultValue: null as number | null,
    isSensitive: false,
  },
  localProviderEnabled: {
    key: 'system.auth.localProvider.enabled',
    schema: z.boolean(),
    defaultValue: true,
    isSensitive: false,
  },
  baseDomain: {
    key: 'system.domain.base',
    schema: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-z0-9.-]+$/i, {
        message: '域名只能包含字母、数字、连字符和点',
      }),
    defaultValue: DEFAULT_BASE_DOMAIN,
    isSensitive: false,
  },
  oauthGatewayUrl: {
    key: 'system.auth.oauth.gatewayUrl',
    schema: nullableHttpUrl,
    defaultValue: null as string | null,
    isSensitive: false,
  },
  oauthGoogleClientId: {
    key: 'system.auth.oauth.google.clientId',
    schema: nullableNonEmptyString,
    defaultValue: null as string | null,
    isSensitive: false,
  },
  oauthGoogleClientSecret: {
    key: 'system.auth.oauth.google.clientSecret',
    schema: nullableNonEmptyString,
    defaultValue: null as string | null,
    isSensitive: true,
  },
  oauthGithubClientId: {
    key: 'system.auth.oauth.github.clientId',
    schema: nullableNonEmptyString,
    defaultValue: null as string | null,
    isSensitive: false,
  },
  oauthGithubClientSecret: {
    key: 'system.auth.oauth.github.clientSecret',
    schema: nullableNonEmptyString,
    defaultValue: null as string | null,
    isSensitive: true,
  },
  oauthAppleWebClientId: {
    key: 'system.auth.oauth.apple.webClientId',
    schema: nullableNonEmptyString,
    defaultValue: null as string | null,
    isSensitive: false,
  },
  oauthAppleAppBundleId: {
    key: 'system.auth.oauth.apple.appBundleId',
    schema: nonEmptyString,
    defaultValue: 'app.afilmory',
    isSensitive: false,
  },
  oauthAppleTeamId: {
    key: 'system.auth.oauth.apple.teamId',
    schema: nullableNonEmptyString,
    defaultValue: null as string | null,
    isSensitive: false,
  },
  oauthAppleKeyId: {
    key: 'system.auth.oauth.apple.keyId',
    schema: nullableNonEmptyString,
    defaultValue: null as string | null,
    isSensitive: false,
  },
} as const

export type SystemSettingDbField = keyof typeof SYSTEM_SETTING_DEFINITIONS

export type SystemSettingField = SystemSettingDbField
export type SystemSettingKey = (typeof SYSTEM_SETTING_DEFINITIONS)[SystemSettingDbField]['key']

export const SYSTEM_SETTING_KEYS = Object.values(SYSTEM_SETTING_DEFINITIONS).map(definition => definition.key)
