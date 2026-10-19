import { coreApi } from '~/lib/api-client'
import { camelCaseKeys } from '~/lib/case'

import type {
  SiteAuthorProfile,
  SiteSettingEntryInput,
  SiteSettingUiSchemaResponse,
  UpdateSiteAuthorPayload,
} from './types'

const SITE_SETTINGS_ENDPOINT = '/site/settings'

export async function getSiteSettingUiSchema() {
  return await coreApi<SiteSettingUiSchemaResponse>(`${SITE_SETTINGS_ENDPOINT}/ui-schema`)
}

export async function updateSiteSettings(entries: readonly SiteSettingEntryInput[]) {
  return await coreApi<{ updated: readonly SiteSettingEntryInput[] }>(`${SITE_SETTINGS_ENDPOINT}`, {
    method: 'POST',
    body: { entries },
  })
}

export async function getSiteAuthorProfile() {
  return camelCaseKeys<SiteAuthorProfile>(await coreApi<SiteAuthorProfile>(`${SITE_SETTINGS_ENDPOINT}/author`))
}

export async function updateSiteAuthorProfile(payload: UpdateSiteAuthorPayload) {
  return await coreApi<SiteAuthorProfile>(`${SITE_SETTINGS_ENDPOINT}/author`, {
    method: 'POST',
    body: payload,
  })
}
