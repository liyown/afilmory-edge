// Site branding used by the OG cards and the homepage shell meta tags.
// Reading the `settings` table directly avoids booting the DI graph for what
// is a handful of non-sensitive string values.

const CACHE_KEY = 'og:site-config'
const CACHE_TTL_SECONDS = 60
const DEFAULT_SITE_NAME = 'Afilmory'
const DEFAULT_ACCENT_COLOR = '#007bff'

export interface OgSiteConfig {
  name: string
  title: string
  description: string
  accentColor: string
  authorName: string | null
  authorAvatar: string | null
}

type SettingRow = { key: string, value: string }

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

export async function loadOgSiteConfig(env: Pick<Env, 'CACHE' | 'DB'>): Promise<OgSiteConfig> {
  const cached = await env.CACHE.get(CACHE_KEY, 'json')
  if (cached) {
    return cached as OgSiteConfig
  }

  const { results } = await env.DB.prepare(
    `select "key", "value" from "settings" where "key" in ('site.name', 'site.title', 'site.description', 'site.accentColor')`,
  ).all<SettingRow>()
  const values = new Map((results ?? []).map(row => [row.key, row.value]))

  const author = await env.DB.prepare(
    `select "name", "display_username", "username", "image" from "auth_user" order by case when "role" = 'superadmin' then 0 else 1 end, "created_at" asc limit 1`,
  ).first<AuthorRow>()

  const name = normalize(values.get('site.name')) ?? normalize(values.get('site.title')) ?? DEFAULT_SITE_NAME
  const title = normalize(values.get('site.title')) ?? name
  const authorName
    = normalize(author?.display_username) ?? normalize(author?.username) ?? normalize(author?.name) ?? name

  const config: OgSiteConfig = {
    name,
    title,
    description: normalize(values.get('site.description')) ?? '',
    accentColor: normalize(values.get('site.accentColor')) ?? DEFAULT_ACCENT_COLOR,
    authorName,
    authorAvatar: normalize(author?.image),
  }

  await env.CACHE.put(CACHE_KEY, JSON.stringify(config), { expirationTtl: CACHE_TTL_SECONDS })
  return config
}
