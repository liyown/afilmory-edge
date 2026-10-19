import type { GatewayConfig } from './config'

export function resolveTargetHost(config: GatewayConfig): string {
  return config.baseDomain
}

export function resolveProtocol(config: GatewayConfig, host: string): 'http' | 'https' {
  if (!config.forceHttps) {
    return host.includes('localhost') || host.startsWith('127.') || host.endsWith('.local') ? 'http' : 'https'
  }

  if (host.includes('localhost') || host.startsWith('127.') || host.endsWith('.local')) {
    return 'http'
  }

  return 'https'
}

export function buildForwardLocation(params: {
  config: GatewayConfig
  provider: string
  host: string
  query: URLSearchParams
}): string {
  const basePath = `${params.config.callbackBasePath}/${params.provider}`
  const queryString = params.query.toString()
  const protocol = resolveProtocol(params.config, params.host)
  const baseUrl = `${protocol}://${params.host}${basePath}`
  return queryString ? `${baseUrl}?${queryString}` : baseUrl
}
