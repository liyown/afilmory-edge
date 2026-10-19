import { ImageResponse } from 'workers-og'

import { GEIST_MEDIUM_B64 } from './assets/geist-medium.b64'

const WIDTH = 1200
const HEIGHT = 630

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

let fontCache: ArrayBuffer | undefined

function geistFont(): ArrayBuffer {
  fontCache ??= decodeBase64(GEIST_MEDIUM_B64)
  return fontCache
}

interface OgPhoto {
  id: string
  title?: string
  description?: string
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/**
 * T1.5: 1200x630 OG card, rendered with workers-og (satori + resvg-wasm
 * pre-wired for workerd). Input is plain HTML, so no JSX/React runtime.
 */
export function renderOgImage(photo: OgPhoto): Response {
  const title = escapeHtml(photo.title || photo.id)
  const description = escapeHtml(photo.description || '')

  const html = `
    <div style="width:${WIDTH}px;height:${HEIGHT}px;display:flex;flex-direction:column;justify-content:space-between;padding:72px;background:linear-gradient(135deg,#0a0a0a 0%,#1c1c1e 55%,#2c2c2e 100%);color:#f5f5f7;font-family:Geist">
      <div style="display:flex;font-size:28px;color:#8e8e93;letter-spacing:0.02em">AFILMORY</div>
      <div style="display:flex;flex-direction:column">
        <div style="display:flex;font-size:64px;font-weight:500;line-height:1.15">${title}</div>
        <div style="display:flex;margin-top:18px;font-size:30px;color:#aeaeb2;line-height:1.4">${description}</div>
      </div>
      <div style="display:flex;font-size:24px;color:#8e8e93">${escapeHtml(photo.id)}</div>
    </div>
  `

  return new ImageResponse(html, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [{ name: 'Geist', data: geistFont(), weight: 500, style: 'normal' }],
  })
}
