// Site branding used by the OG cards, the SPA shell, and its runtime config.
// Reading the `settings` table directly avoids booting the DI graph for what
// is a handful of non-sensitive string values.

import { SITE_CONFIG_CACHE_KEY } from '@core/modules/configuration/site-setting/site-setting.type'

const CACHE_KEY = SITE_CONFIG_CACHE_KEY
const CACHE_TTL_SECONDS = 60
const DEFAULT_SITE_NAME = 'Afilmory'
const DEFAULT_ACCENT_COLOR = '#007bff'

export interface SiteConfigAuthor {
  name: string
  url?: string
  avatar?: string
}

export interface SiteConfigViewer {
  regions?: {
    labelPlacement?: 'edge' | 'floating'
  }
}

export interface SiteConfigSocial {
  twitter?: string
  github?: string
}

export interface SiteConfigFeed {
  folo?: {
    challenge?: {
      feedId?: string
      userId?: string
    }
  }
}

/** Runtime config injected into `window.__SITE_CONFIG__`. */
export interface SiteConfigPayload {
  name: string
  title: string
  description: string
  url?: string
  accentColor: string
  author: SiteConfigAuthor
  viewer?: SiteConfigViewer
  social?: SiteConfigSocial
  feed?: SiteConfigFeed
  map?: string[]
  mapStyle?: string
  mapProjection?: 'globe' | 'mercator'
}

export interface OgSiteConfig {
  name: string
  title: string
  description: string
  accentColor: string
  authorName: string | null
  authorAvatar: string | null
  siteConfig: SiteConfigPayload
}

type SettingRow = { key: string; value: string }

type AuthorRow = {
  name: string | null
  display_username: string | null
  username: string | null
  image: string | null
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

function assignString(values: Map<string, string>, key: string, updater: (value: string) => void): void {
  const value = normalize(values.get(key))
  if (value) {
    updater(value)
  }
}

function parseStringArray(value: string | null | undefined): string[] | undefined {
  const normalized = normalize(value)
  if (!normalized) {
    return undefined
  }

  try {
    const parsed = JSON.parse(normalized)
    if (!Array.isArray(parsed)) {
      return undefined
    }
    const result = parsed.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim())
    return result.length > 0 ? result : undefined
  } catch {
    return undefined
  }
}

export async function loadOgSiteConfig(env: Pick<Env, 'CACHE' | 'DB'>): Promise<OgSiteConfig> {
  const cached = await env.CACHE.get(CACHE_KEY, 'json')
  if (cached) {
    return cached as OgSiteConfig
  }

  const { results } = await env.DB.prepare(
    `select "key", "value" from "settings" where "key" like 'site.%'`,
  ).all<SettingRow>()
  const values = new Map(
    (results ?? []).filter((row) => typeof row.value === 'string').map((row) => [row.key, row.value]),
  )

  const author = await env.DB.prepare(
    `select "name", "display_username", "username", "image" from "auth_user" order by case when "role" = 'superadmin' then 0 else 1 end, "created_at" asc limit 1`,
  ).first<AuthorRow>()

  const name = normalize(values.get('site.name')) ?? normalize(values.get('site.title')) ?? DEFAULT_SITE_NAME
  const title = normalize(values.get('site.title')) ?? name
  const description = normalize(values.get('site.description')) ?? ''
  const accentColor = normalize(values.get('site.accentColor')) ?? DEFAULT_ACCENT_COLOR
  const authorName =
    normalize(author?.display_username) ?? normalize(author?.username) ?? normalize(author?.name) ?? name
  const authorAvatar = normalize(author?.image)

  const siteConfig: SiteConfigPayload = {
    name,
    title,
    description,
    accentColor,
    author: {
      name: authorName,
      ...(authorAvatar ? { avatar: authorAvatar } : {}),
    },
  }

  assignString(values, 'site.url', (value) => {
    siteConfig.url = value
  })

  const social: SiteConfigSocial = {}
  assignString(values, 'site.social.twitter', (value) => {
    social.twitter = value
  })
  assignString(values, 'site.social.github', (value) => {
    social.github = value
  })
  if (Object.keys(social).length > 0) {
    siteConfig.social = social
  }

  const feedId = normalize(values.get('site.feed.folo.challenge.feedId'))
  const userId = normalize(values.get('site.feed.folo.challenge.userId'))
  if (feedId || userId) {
    siteConfig.feed = {
      folo: {
        challenge: {
          ...(feedId ? { feedId } : {}),
          ...(userId ? { userId } : {}),
        },
      },
    }
  }

  const labelPlacement = normalize(values.get('site.viewer.regions.labelPlacement'))
  if (labelPlacement === 'edge' || labelPlacement === 'floating') {
    siteConfig.viewer = { regions: { labelPlacement } }
  }

  const mapProviders = parseStringArray(values.get('site.map.providers'))
  if (mapProviders) {
    siteConfig.map = mapProviders
  }

  assignString(values, 'site.mapStyle', (value) => {
    siteConfig.mapStyle = value
  })

  const mapProjection = normalize(values.get('site.mapProjection'))
  if (mapProjection === 'globe' || mapProjection === 'mercator') {
    siteConfig.mapProjection = mapProjection
  }

  const config: OgSiteConfig = {
    name,
    title,
    description,
    accentColor,
    authorName,
    authorAvatar,
    siteConfig,
  }

  await env.CACHE.put(CACHE_KEY, JSON.stringify(config), { expirationTtl: CACHE_TTL_SECONDS })
  return config
}
