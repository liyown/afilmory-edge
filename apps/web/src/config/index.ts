import type { SiteConfig } from '@config'
import defaultSiteConfig from '@config'
import { merge } from 'es-toolkit/compat'

const defaultInjectConfig = {
  useApi: false,
  useNext: false,
  useCloud: false,
}

export const injectConfig = merge(defaultInjectConfig, __CONFIG__)

const getInjectedSiteConfig = (): Partial<SiteConfig> | undefined => {
  if (window.__SITE_CONFIG__) {
    return window.__SITE_CONFIG__
  }

  if (typeof globalThis !== 'undefined' && '__SITE_CONFIG__' in globalThis) {
    return (globalThis as typeof globalThis & { __SITE_CONFIG__?: Partial<SiteConfig> }).__SITE_CONFIG__
  }

  return undefined
}

const runtimeSiteConfig = getInjectedSiteConfig() ?? {}

const mergedSiteConfig: SiteConfig = merge(defaultSiteConfig, runtimeSiteConfig)

// The Worker injects the live author profile on every shell request. Replace
// the whole object instead of deep-merging so a cleared avatar or URL does not
// fall back to the build-time identity from config.json.
if (runtimeSiteConfig.author) {
  mergedSiteConfig.author = { ...runtimeSiteConfig.author, url: runtimeSiteConfig.author.url ?? '' }
}

export const siteConfig = mergedSiteConfig
