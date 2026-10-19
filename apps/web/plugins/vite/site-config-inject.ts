import process from 'node:process'

import { DOMParser } from 'linkedom'
import type { Plugin } from 'vite'

import { siteConfig } from '../../../../site.config'

const CONFIG_SCRIPT_ID = 'config'
const INJECTED_SCRIPT_ID = 'config-runtime'

// Set to `false` when the Worker injects the live site config at request time.
function shouldEmbedSiteConfig(): boolean {
  const flag = process.env.AFILMORY_EMBED_SITE_CONFIG?.trim().toLowerCase()
  return flag !== 'false'
}

export function siteConfigInjectPlugin(): Plugin {
  const siteConfigPayload = JSON.stringify(siteConfig)
  const scriptContent = `window.__SITE_CONFIG__ = ${siteConfigPayload};`
  const parser = new DOMParser()

  return {
    name: 'site-config-inject',
    enforce: 'pre',
    transformIndexHtml(html) {
      if (!shouldEmbedSiteConfig()) {
        return html
      }

      const document = parser.parseFromString(html, 'text/html')
      if (document.querySelector(`#${INJECTED_SCRIPT_ID}`)) {
        return html
      }

      const scriptEl = document.createElement('script', 'text/javascript')
      scriptEl.id = INJECTED_SCRIPT_ID
      scriptEl.textContent = scriptContent

      const configScript = document.querySelector(`#${CONFIG_SCRIPT_ID}`)
      if (configScript?.parentNode) {
        configScript.parentNode.insertBefore(scriptEl, configScript.nextSibling)
      }
      else if (document.head) {
        document.head.append(scriptEl)
      }
      else {
        const fallbackParent = document.body ?? document.documentElement
        fallbackParent?.append(scriptEl)
      }

      return document.toString()
    },
  }
}
