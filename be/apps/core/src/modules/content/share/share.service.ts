import type { PhotoManifestItem } from '@afilmory/typing'
import { SiteSettingService } from '@core/modules/configuration/site-setting/site-setting.service'
import { ManifestService } from '@core/modules/content/manifest/manifest.service'
import { thumbHashToDataURL } from 'thumbhash'
import { injectable } from 'tsyringe'

const DEFAULT_TAG_LIMIT = 9
const MAX_TAG_LIMIT = 24
const TRAILING_SLASHES = /\/+$/
const WWW_PREFIX = /^www\./
const THUMBHASH_BYTE_PATTERN = /.{1,2}/g

export interface ShareIframeQuery {
  id?: string
  ids?: string
  tag?: string
  limit?: string
  layout?: string
}

export interface ShareIframeDocument {
  status: 200 | 404
  html: string
}

type CollectionLayout = 'grid' | 'strip'

@injectable()
export class ShareService {
  constructor(
    private readonly manifestService: ManifestService,
    private readonly siteSettingService: SiteSettingService,
  ) {}

  async renderIframe(query: ShareIframeQuery, requestUrl: string): Promise<ShareIframeDocument> {
    const siteConfig = await this.siteSettingService.getSiteConfig()
    const baseUrl = resolveBaseUrl(siteConfig.url, requestUrl)
    const siteName = resolveSiteName(baseUrl, siteConfig.name)

    const single = query.id?.trim()
    if (single) {
      const photos = await this.manifestService.getPhotosByIds([single])
      const photo = photos[0]
      if (!photo) {
        return renderNotFound()
      }
      return {
        status: 200,
        html: renderDocument(photo.title || photo.id, renderPhoto(photo, baseUrl, siteName)),
      }
    }

    const idList = parseIdList(query.ids)
    if (idList.length > 0) {
      const photos = await this.manifestService.getPhotosByIds(idList)
      if (photos.length === 0) {
        return renderNotFound()
      }
      const title = `${photos.length} photos`
      return {
        status: 200,
        html: renderDocument(
          title,
          renderCollection({
            photos,
            header: { title: escapeHtml(title) },
            viewAllUrl: `${baseUrl}/`,
            overflow: null,
            baseUrl,
            siteName,
            layout: resolveLayout(query.layout, photos.length),
          }),
        ),
      }
    }

    const tag = query.tag?.trim()
    if (tag) {
      const manifest = await this.manifestService.getManifest()
      const matched = manifest.data.filter(photo => (photo.tags ?? []).includes(tag))
      if (matched.length === 0) {
        return renderNotFound()
      }

      const limit = parseLimit(query.limit)
      const shown = matched.slice(0, limit)
      const overflowCount = matched.length - shown.length
      const filterUrl = `${baseUrl}/?tags=${encodeURIComponent(tag)}`
      const hasOverflow = overflowCount > 0

      return {
        status: 200,
        html: renderDocument(
          `#${tag}`,
          renderCollection({
            photos: shown,
            header: {
              title: `<span class="af-tag-pill">#${escapeHtml(tag)}</span>`,
              count: `${shown.length} of ${matched.length}`,
            },
            viewAllUrl: filterUrl,
            overflow: hasOverflow ? { count: overflowCount, url: filterUrl } : null,
            baseUrl,
            siteName,
            layout: resolveLayout(query.layout, shown.length + (hasOverflow ? 1 : 0)),
          }),
        ),
      }
    }

    return renderNotFound()
  }
}

function renderNotFound(): ShareIframeDocument {
  return {
    status: 404,
    html: renderDocument(
      'Not found',
      '<article class="af-card" data-afilmory-root><div class="af-empty">Not found</div></article>',
    ),
  }
}

interface RenderCollectionInput {
  photos: PhotoManifestItem[]
  header: { title: string, count?: string }
  viewAllUrl: string
  overflow: { count: number, url: string } | null
  baseUrl: string
  siteName: string
  layout: CollectionLayout
}

function renderCollection(input: RenderCollectionInput): string {
  const { photos, header, viewAllUrl, overflow, baseUrl, siteName, layout } = input
  const tiles = photos.map(photo => renderCollectionTile(photo, baseUrl)).join('')
  const columns = photos.length + (overflow ? 1 : 0) > 4 ? 3 : 2

  const overflowTile = overflow
    ? `<a class="af-grid-cell af-overflow" href="${escapeHtml(overflow.url)}" target="_blank" rel="noopener noreferrer">+${overflow.count} more</a>`
    : ''

  const body
    = layout === 'grid'
      ? `<div class="af-grid" style="grid-template-columns:repeat(${columns}, 1fr)">${tiles}${overflowTile}</div>`
      : `<div class="af-strip">${tiles}${overflowTile}</div>`

  return `<article class="af-card" data-afilmory-root>
  <div class="af-coll-header">
    <div class="af-coll-title">${header.title}${header.count ? `<span class="af-count">${escapeHtml(header.count)}</span>` : ''}</div>
    <a class="af-view-link" href="${escapeHtml(viewAllUrl)}" target="_blank" rel="noopener noreferrer">View all →</a>
  </div>
  ${body}
  <div class="af-footer">${renderBadge(baseUrl, siteName, true)}</div>
</article>`
}

function renderCollectionTile(photo: PhotoManifestItem, baseUrl: string): string {
  const detailUrl = getPhotoDetailUrl(baseUrl, photo.id)
  const label = escapeHtml(photo.title || photo.id)
  const background = renderThumbHashBackground(photo)

  return `<a class="af-grid-cell" href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${label}" style="${background}">
  <img src="${escapeHtml(photo.thumbnailUrl)}" alt="${label}" loading="lazy">
</a>`
}

function renderPhoto(photo: PhotoManifestItem, baseUrl: string, siteName: string): string {
  const detailUrl = getPhotoDetailUrl(baseUrl, photo.id)
  const label = escapeHtml(photo.title || photo.id)
  const aspectRatio = photo.width && photo.height ? `${photo.width} / ${photo.height}` : '3 / 2'
  const background = renderThumbHashBackground(photo)

  const subParts = formatPhotoSub(photo)
  const sub
    = subParts.length > 0
      ? `<div class="af-sub">${subParts.map(part => `<span>${escapeHtml(part)}</span>`).join('<span class="af-sep">·</span>')}</div>`
      : ''
  const chips = formatExifChips(photo)
  const exif
    = chips.length > 0
      ? `<div class="af-exif">${chips.map(chip => `<span class="af-chip">${escapeHtml(chip)}</span>`).join('')}</div>`
      : ''

  return `<article class="af-card" data-afilmory-root>
  <div class="af-photo" style="aspect-ratio:${aspectRatio};${background}">
    <a href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${label}">
      <img src="${escapeHtml(photo.thumbnailUrl)}" alt="${label}" loading="lazy">
    </a>
    ${renderBadge(baseUrl, siteName, false)}
  </div>
  <div class="af-meta">
    <div class="af-meta-head">
      <div class="af-title">${label}</div>
      <a class="af-view-link" href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer">View →</a>
    </div>
    ${sub}
    ${exif}
  </div>
</article>`
}

function renderBadge(baseUrl: string, siteName: string, inline: boolean): string {
  const className = inline ? 'af-badge af-badge-inline' : 'af-badge'
  return `<a class="${className}" href="${escapeHtml(`${baseUrl}/`)}" target="_blank" rel="noopener noreferrer"><span class="af-badge-dot"></span>${escapeHtml(siteName)}<span class="af-badge-via">via AFilmory</span></a>`
}

function renderThumbHashBackground(photo: PhotoManifestItem): string {
  if (!photo.thumbHash) {
    return ''
  }
  try {
    const dataUrl = thumbHashToDataURL(decompressThumbHash(photo.thumbHash))
    return `background-image:url(${dataUrl});background-size:cover;background-position:center;`
  }
  catch {
    return ''
  }
}

function decompressThumbHash(compressed: string): Uint8Array {
  const pairs = compressed.match(THUMBHASH_BYTE_PATTERN) ?? []
  return Uint8Array.from(pairs.map(pair => Number.parseInt(pair, 16)))
}

function getPhotoDetailUrl(baseUrl: string, photoId: string): string {
  return `${baseUrl}/photos/${encodeURIComponent(photoId)}`
}

function resolveBaseUrl(candidate: string | undefined, requestUrl: string): string {
  const normalized = candidate?.trim().replace(TRAILING_SLASHES, '')
  if (normalized) {
    return normalized
  }
  try {
    return new URL(requestUrl).origin
  }
  catch {
    return ''
  }
}

function resolveSiteName(baseUrl: string, fallback: string): string {
  try {
    return new URL(baseUrl).hostname.replace(WWW_PREFIX, '') || fallback
  }
  catch {
    return fallback
  }
}

function parseIdList(value: string | undefined): string[] {
  if (!value) {
    return []
  }
  return value
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
}

function parseLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TAG_LIMIT
  }
  return Math.max(1, Math.min(MAX_TAG_LIMIT, parsed))
}

function resolveLayout(requested: string | undefined, photoCount: number): CollectionLayout {
  if (requested === 'grid' || requested === 'strip') {
    return requested
  }
  return photoCount <= 4 ? 'strip' : 'grid'
}

function formatExifChips(photo: PhotoManifestItem): string[] {
  const exif = photo.exif
  if (!exif) {
    return []
  }

  const chips: string[] = []
  const focalSource = exif.FocalLengthIn35mmFormat ?? exif.FocalLength
  if (focalSource) {
    chips.push(`${Number.parseInt(String(focalSource))}mm`)
  }
  if (exif.FNumber) {
    chips.push(`f/${exif.FNumber}`)
  }
  if (exif.ExposureTime) {
    chips.push(formatShutter(exif.ExposureTime))
  }
  if (exif.ISO) {
    chips.push(`ISO ${exif.ISO}`)
  }
  return chips
}

function formatShutter(value: string | number): string {
  const raw = String(value)
  if (raw.includes('/')) {
    return `${raw}s`
  }
  const parsed = Number.parseFloat(raw)
  if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) {
    return `1/${Math.round(1 / parsed)}s`
  }
  return `${raw}s`
}

function formatPhotoSub(photo: PhotoManifestItem): string[] {
  const parts: string[] = []
  const make = photo.exif?.Make
  const model = photo.exif?.Model
  if (model) {
    parts.push(make && !model.toLowerCase().includes(make.toLowerCase()) ? `${make} ${model}` : model)
  }
  else if (make) {
    parts.push(make)
  }

  const lens = photo.exif?.LensModel
  if (lens) {
    parts.push(lens)
  }

  const city = photo.location?.city
  if (city) {
    parts.push(city)
  }

  if (photo.dateTaken) {
    const date = new Date(photo.dateTaken)
    if (!Number.isNaN(date.getTime())) {
      const year = date.getUTCFullYear()
      const month = String(date.getUTCMonth() + 1).padStart(2, '0')
      const day = String(date.getUTCDate()).padStart(2, '0')
      parts.push(`${year}·${month}·${day}`)
    }
  }

  return parts
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

const SHARE_STYLES = `
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.92);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
  font-feature-settings: "ss01", "cv11";
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
body { display: block; overflow: hidden; }
a { color: inherit; text-decoration: none; }
img { display: block; max-width: 100%; }

.af-card { background: #0a0a0a; overflow: hidden; color: rgba(255, 255, 255, 0.92); width: 100%; }

.af-photo { position: relative; background: #050505; overflow: hidden; }
.af-photo img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; }

.af-badge {
  position: absolute;
  bottom: 12px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 10px;
  background: rgba(20, 20, 20, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  color: rgba(255, 255, 255, 0.92);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  text-decoration: none;
}
.af-badge-inline { position: static; }
.af-badge-dot { width: 5px; height: 5px; background: #4ade80; }
.af-badge-via { font-size: 9px; opacity: 0.5; margin-left: 4px; font-weight: 400; }

.af-meta { padding: 14px 16px 16px; border-top: 1px solid rgba(255, 255, 255, 0.06); }
.af-meta-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.af-title { font-size: 15px; font-weight: 600; color: rgba(255, 255, 255, 0.95); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.af-view-link { font-size: 11px; color: #5eb3ff; flex-shrink: 0; font-weight: 500; letter-spacing: 0.02em; }
.af-sub { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 11px; color: rgba(255, 255, 255, 0.55); margin-bottom: 10px; font-variant-numeric: tabular-nums; }
.af-sub .af-sep { color: rgba(255, 255, 255, 0.2); }

.af-exif { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.af-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.04); color: rgba(255, 255, 255, 0.85); padding: 3px 8px; font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }

.af-coll-header { padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
.af-coll-title { font-size: 13px; font-weight: 600; color: rgba(255, 255, 255, 0.92); display: flex; align-items: center; gap: 10px; min-width: 0; }
.af-count { font-size: 11px; color: rgba(255, 255, 255, 0.45); font-variant-numeric: tabular-nums; font-weight: 400; }
.af-tag-pill { font-size: 11px; padding: 2px 8px; background: rgba(94, 179, 255, 0.12); border: 1px solid rgba(94, 179, 255, 0.2); border-radius: 4px; color: #5eb3ff; font-weight: 500; letter-spacing: 0.01em; white-space: nowrap; }

.af-grid { display: grid; gap: 1px; background: rgba(255, 255, 255, 0.04); }
.af-grid-cell { position: relative; aspect-ratio: 1; background: #050505; overflow: hidden; }
.af-grid-cell img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease; }
.af-grid-cell:hover img { transform: scale(1.04); }
.af-overflow { display: flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.03); color: rgba(255, 255, 255, 0.55); font-size: 14px; font-weight: 500; letter-spacing: 0.02em; }
.af-overflow:hover { background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.85); }

.af-strip { display: flex; gap: 4px; padding: 8px; overflow-x: auto; scroll-snap-type: x mandatory; background: rgba(0, 0, 0, 0.4); scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.15) transparent; }
.af-strip::-webkit-scrollbar { height: 6px; }
.af-strip::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); }
.af-strip > * { flex: 0 0 38%; scroll-snap-align: start; aspect-ratio: 3 / 4; position: relative; background: #050505; overflow: hidden; }
.af-strip img { width: 100%; height: 100%; object-fit: cover; }

.af-footer { padding: 10px 16px; text-align: right; border-top: 1px solid rgba(255, 255, 255, 0.06); }

.af-empty { padding: 48px 16px; text-align: center; color: rgba(255, 255, 255, 0.4); font-size: 13px; }
`

const RESIZE_SCRIPT = `(function(){
  var lastHeight = 0;
  function measure(){
    var card = document.querySelector('[data-afilmory-root]');
    if (card) {
      var rect = card.getBoundingClientRect();
      return Math.ceil(rect.height);
    }
    return Math.ceil(document.documentElement.getBoundingClientRect().height);
  }
  function postSize(){
    try {
      var h = measure();
      if (!h || h === lastHeight) return;
      lastHeight = h;
      parent.postMessage({ type: 'afilmory:resize', height: h }, '*');
    } catch (e) {}
  }
  function attach(){
    postSize();
    document.querySelectorAll('img').forEach(function(img){
      if (img.complete) return;
      img.addEventListener('load', postSize);
      img.addEventListener('error', postSize);
    });
    if (typeof ResizeObserver !== 'undefined') {
      try {
        var root = document.querySelector('[data-afilmory-root]') || document.documentElement;
        new ResizeObserver(postSize).observe(root);
      } catch (e) {}
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
  window.addEventListener('load', postSize);
  window.addEventListener('resize', postSize);
  var retries = 0;
  var retryId = setInterval(function(){
    postSize();
    if (++retries >= 6) clearInterval(retryId);
  }, 250);
})();`

function renderDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${SHARE_STYLES}</style>
</head>
<body>
${body}
<script>${RESIZE_SCRIPT}</script>
</body>
</html>`
}
