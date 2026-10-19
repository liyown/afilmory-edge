export interface DashboardSiteConfig {
  name?: string
  title?: string
}

declare global {
  interface Window {
    __SITE_CONFIG__?: DashboardSiteConfig
  }
}

const runtimeSiteConfig = typeof window === 'undefined' ? undefined : window.__SITE_CONFIG__

export const dashboardSiteName = runtimeSiteConfig?.name?.trim() || 'Afilmory'
export const dashboardSiteTitle = runtimeSiteConfig?.title?.trim() || dashboardSiteName
