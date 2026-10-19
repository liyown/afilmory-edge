import type { UiSchemaTFunction } from '@core/modules/ui/ui-schema/ui-schema.i18n'
import { identityUiSchemaT } from '@core/modules/ui/ui-schema/ui-schema.i18n'
import type { UiNode, UiSchema } from '@core/modules/ui/ui-schema/ui-schema.type'

import type { SystemSettingField } from './system-setting.constants'

export const SYSTEM_SETTING_UI_SCHEMA_VERSION = '1.7.0'

export function createSystemSettingUiSchema(t: UiSchemaTFunction): UiSchema<SystemSettingField> {
  return {
    version: SYSTEM_SETTING_UI_SCHEMA_VERSION,
    title: t('system.title'),
    description: t('system.description'),
    sections: [
      {
        type: 'section',
        id: 'registration-control',
        title: t('system.sections.registration.title'),
        description: t('system.sections.registration.description'),
        icon: 'user-cog',
        children: [
          {
            type: 'field',
            id: 'registration-allow',
            title: t('system.sections.registration.fields.allow-registration.title'),
            description: t('system.sections.registration.fields.allow-registration.description'),
            key: 'allowRegistration',
            component: {
              type: 'switch',
            },
          },
          {
            type: 'field',
            id: 'local-provider-enabled',
            title: t('system.sections.registration.fields.local-provider.title'),
            description: t('system.sections.registration.fields.local-provider.description'),
            key: 'localProviderEnabled',
            component: {
              type: 'switch',
            },
          },
          {
            type: 'field',
            id: 'registration-max-users',
            title: t('system.sections.registration.fields.max-users.title'),
            description: t('system.sections.registration.fields.max-users.description'),
            helperText: t('system.sections.registration.fields.max-users.helper'),
            key: 'maxRegistrableUsers',
            component: {
              type: 'text' as const,
              inputType: 'number',
              placeholder: t('system.sections.registration.fields.max-users.placeholder'),
            },
          },
        ],
      },
      {
        type: 'section',
        id: 'oauth-providers',
        title: t('system.sections.oauth.title'),
        description: t('system.sections.oauth.description'),
        icon: 'shield-check',
        children: [
          {
            type: 'field',
            id: 'oauth-gateway-url',
            title: t('system.sections.oauth.fields.gateway.title'),
            description: t('system.sections.oauth.fields.gateway.description'),
            helperText: t('system.sections.oauth.fields.gateway.helper'),
            key: 'oauthGatewayUrl',
            component: {
              type: 'text',
              placeholder: t('system.sections.oauth.fields.gateway.placeholder'),
            },
          },
          {
            type: 'group',
            id: 'oauth-google',
            title: t('system.sections.oauth.groups.google.title'),
            description: t('system.sections.oauth.groups.google.description'),
            icon: 'badge-check',
            children: [
              {
                type: 'field',
                id: 'oauth-google-client-id',
                title: t('system.sections.oauth.groups.google.fields.client-id.title'),
                description: t('system.sections.oauth.groups.google.fields.client-id.description'),
                key: 'oauthGoogleClientId',
                component: {
                  type: 'text',
                  placeholder: t('system.sections.oauth.groups.google.fields.client-id.placeholder'),
                },
              },
              {
                type: 'field',
                id: 'oauth-google-client-secret',
                title: t('system.sections.oauth.groups.google.fields.client-secret.title'),
                description: t('system.sections.oauth.groups.google.fields.client-secret.description'),
                key: 'oauthGoogleClientSecret',
                component: {
                  type: 'secret',
                  placeholder: t('system.sections.oauth.groups.google.fields.client-secret.placeholder'),
                  revealable: true,
                  autoComplete: 'off',
                },
              },
            ],
          },
          {
            type: 'group',
            id: 'oauth-github',
            title: t('system.sections.oauth.groups.github.title'),
            description: t('system.sections.oauth.groups.github.description'),
            icon: 'github',
            children: [
              {
                type: 'field',
                id: 'oauth-github-client-id',
                title: t('system.sections.oauth.groups.github.fields.client-id.title'),
                description: t('system.sections.oauth.groups.github.fields.client-id.description'),
                key: 'oauthGithubClientId',
                component: {
                  type: 'text',
                  placeholder: t('system.sections.oauth.groups.github.fields.client-id.placeholder'),
                },
              },
              {
                type: 'field',
                id: 'oauth-github-client-secret',
                title: t('system.sections.oauth.groups.github.fields.client-secret.title'),
                description: t('system.sections.oauth.groups.github.fields.client-secret.description'),
                key: 'oauthGithubClientSecret',
                component: {
                  type: 'secret',
                  placeholder: t('system.sections.oauth.groups.github.fields.client-secret.placeholder'),
                  revealable: true,
                  autoComplete: 'off',
                },
              },
            ],
          },
          {
            type: 'group',
            id: 'oauth-apple',
            title: t('system.sections.oauth.groups.apple.title'),
            description: t('system.sections.oauth.groups.apple.description'),
            icon: 'apple',
            children: [
              {
                type: 'field',
                id: 'oauth-apple-web-client-id',
                title: t('system.sections.oauth.groups.apple.fields.web-client-id.title'),
                description: t('system.sections.oauth.groups.apple.fields.web-client-id.description'),
                key: 'oauthAppleWebClientId',
                component: {
                  type: 'text',
                  placeholder: t('system.sections.oauth.groups.apple.fields.web-client-id.placeholder'),
                },
              },
              {
                type: 'field',
                id: 'oauth-apple-team-id',
                title: t('system.sections.oauth.groups.apple.fields.team-id.title'),
                description: t('system.sections.oauth.groups.apple.fields.team-id.description'),
                key: 'oauthAppleTeamId',
                component: {
                  type: 'text',
                  placeholder: t('system.sections.oauth.groups.apple.fields.team-id.placeholder'),
                },
              },
              {
                type: 'field',
                id: 'oauth-apple-key-id',
                title: t('system.sections.oauth.groups.apple.fields.key-id.title'),
                description: t('system.sections.oauth.groups.apple.fields.key-id.description'),
                key: 'oauthAppleKeyId',
                component: {
                  type: 'text',
                  placeholder: t('system.sections.oauth.groups.apple.fields.key-id.placeholder'),
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

const SYSTEM_SETTING_SCHEMA_FOR_KEYS = createSystemSettingUiSchema(identityUiSchemaT)

function collectKeys(nodes: ReadonlyArray<UiNode<SystemSettingField>>): SystemSettingField[] {
  const keys: SystemSettingField[] = []

  for (const node of nodes) {
    if (node.type === 'field') {
      keys.push(node.key)
      continue
    }

    keys.push(...collectKeys(node.children))
  }

  return keys
}

export const SYSTEM_SETTING_UI_SCHEMA_KEYS = Array.from(
  new Set(collectKeys(SYSTEM_SETTING_SCHEMA_FOR_KEYS.sections)),
) as SystemSettingField[]
