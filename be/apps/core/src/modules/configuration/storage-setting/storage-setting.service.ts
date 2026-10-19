import { injectable } from 'tsyringe'

import { getUiSchemaTranslator } from '../../ui/ui-schema/ui-schema.i18n'
import type { SettingEntryInput, SettingOption } from '../setting/setting.service'
import { SettingService } from '../setting/setting.service'
import { parseStorageProviders } from '../setting/storage-provider.utils'
import { createStorageProviderFormSchema } from './storage-provider.ui-schema'

type StorageSettingKey = 'builder.storage.providers' | 'builder.storage.activeProvider'

@injectable()
export class StorageSettingService {
  constructor(private readonly settingService: SettingService) {}

  async getUiSchema(options?: SettingOption) {
    const schema = await this.settingService.getUiSchema(options)
    const { t } = getUiSchemaTranslator()
    const providerForm = createStorageProviderFormSchema(t)
    return {
      ...schema,
      schema: {
        ...schema.schema,
        sections: schema.schema.sections.filter(section => section.id.startsWith('builder-storage')),
      },
      providerForm,
    }
  }

  async get(key: StorageSettingKey, options?: SettingOption): Promise<string | null> {
    return await this.settingService.get(key, options ?? {})
  }

  async getMany(
    keys: readonly StorageSettingKey[],
    options?: SettingOption,
  ): Promise<Record<StorageSettingKey, string | null>> {
    return await this.settingService.getMany(keys, options ?? {})
  }

  async setMany(entries: readonly SettingEntryInput[]): Promise<void> {
    const normalized = [...entries]
    const providersEntry = normalized.find(entry => entry.key === 'builder.storage.providers')
    const activeEntryIndex = normalized.findIndex(entry => entry.key === 'builder.storage.activeProvider')
    const activeEntry = activeEntryIndex !== -1 ? normalized[activeEntryIndex] : null
    const activeRaw = activeEntry ? String(activeEntry.value ?? '').trim() : ''
    const activeId = activeRaw.length > 0 ? activeRaw : null

    if (providersEntry) {
      const providers = parseStorageProviders(String(providersEntry.value ?? ''))

      if (!activeId && providers.length === 1) {
        const only = providers[0]
        const nextActiveEntry: SettingEntryInput = {
          key: 'builder.storage.activeProvider',
          value: only.id,
          options: activeEntry?.options,
        }
        if (activeEntryIndex !== -1) {
          normalized[activeEntryIndex] = nextActiveEntry
        }
        else {
          normalized.push(nextActiveEntry)
        }
      }
    }

    await this.settingService.setMany(normalized)
  }

  async delete(key: StorageSettingKey): Promise<void> {
    await this.settingService.delete(key)
  }

  async deleteMany(keys: readonly StorageSettingKey[]): Promise<void> {
    await this.settingService.deleteMany(keys)
  }
}
