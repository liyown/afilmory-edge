// HTML templates for the OG cards. `workers-og` renders HTML through satori,
// so every layout is expressed with the CSS subset satori supports. The
// structure mirrors the original JSX templates: layout choice driven by the
// photo's aspect ratio, with dedicated split/stack/wide arrangements.

export const OG_WIDTH = 1200
export const OG_HEIGHT = 628

const OG_ASPECT = OG_WIDTH / OG_HEIGHT

export interface OgPhoto {
  id: string
  title?: string
  description?: string
  tags?: string[]
  dateTaken?: string
  lastModified?: string
  format?: string
  width?: number
  height?: number
  s3Key?: string
  thumbnailUrl?: string
  originalUrl?: string
  exif?: OgExif | null
}

export interface OgExif {
  Make?: string
  Model?: string
  FNumber?: number
  FocalLength?: string
  FocalLengthIn35mmFormat?: string
  ISO?: number
  ExposureTime?: string | number
  [key: string]: unknown
}

export interface PhotoOgInput {
  photoTitle: string
  siteName: string
  tags: string[]
  formattedDate?: string
  exifInfo: OgExifInfo | null
  thumbnailSrc: string | null
  photoDimensions: { width: number; height: number }
  accentColor: string
}

export interface OgExifInfo {
  focalLength?: string | null
  aperture?: string | null
  iso?: string | number | null
  shutterSpeed?: string | null
  camera?: string | null
}

export interface HomepageOgInput {
  siteName: string
  siteDescription?: string | null
  authorAvatar?: string | null
  accentColor: string
  stats: {
    totalPhotos: number
    uniqueTags: number
    uniqueCameras: number
  }
  featuredPhotos: Array<{ thumbnailSrc: string | null }>
}

type StyleValue = string | number | undefined

// Numeric values are pixels by default, except for these unitless properties.
const UNITLESS_PROPERTIES = new Set([
  'flex',
  'flexGrow',
  'flexShrink',
  'fontWeight',
  'lineHeight',
  'opacity',
  'order',
  'zIndex',
])

function css(styles: Record<string, StyleValue>): string {
  const declarations: string[] = []
  for (const [property, value] of Object.entries(styles)) {
    if (value === undefined) {
      continue
    }
    const name = property.replaceAll(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
    const serialized = typeof value === 'number' && !UNITLESS_PROPERTIES.has(property) ? `${value}px` : String(value)
    declarations.push(`${name}:${serialized}`)
  }
  return declarations.join(';')
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

const FONT_FAMILY = 'Geist, HarmonyOS Sans SC, system-ui, -apple-system, sans-serif'

type LayoutType = 'portrait' | 'square' | 'landscape' | 'wide'

interface LayoutConfig {
  type: LayoutType
  arrangement: 'split' | 'stack' | 'wide'
  padding: number
  gap: number
  photoBox: { maxWidth: number; maxHeight: number }
  infoCompact: boolean
  photoFit: 'cover' | 'contain'
}

function determineLayout(aspect: number): LayoutConfig {
  let finalAspect = aspect
  if (!Number.isFinite(finalAspect) || finalAspect <= 0) {
    finalAspect = 1
  }

  if (finalAspect < 0.9) {
    const padding = 60
    return {
      type: 'portrait',
      arrangement: 'split',
      padding,
      gap: 44,
      photoBox: { maxWidth: OG_WIDTH * 0.44, maxHeight: OG_HEIGHT - padding * 2 },
      infoCompact: false,
      photoFit: 'cover',
    }
  }

  if (finalAspect <= 1.1) {
    const padding = 60
    return {
      type: 'square',
      arrangement: 'split',
      padding,
      gap: 44,
      photoBox: { maxWidth: OG_WIDTH * 0.5, maxHeight: OG_HEIGHT - padding * 2 },
      infoCompact: false,
      photoFit: 'cover',
    }
  }

  if (finalAspect >= 2.35) {
    const padding = 50
    return {
      type: 'wide',
      arrangement: 'wide',
      padding,
      gap: 28,
      photoBox: { maxWidth: OG_WIDTH - padding * 2, maxHeight: 340 },
      infoCompact: true,
      photoFit: 'contain',
    }
  }

  const padding = 54
  const arrangement = finalAspect / OG_ASPECT <= 0.82 ? 'split' : 'stack'
  return {
    type: 'landscape',
    arrangement,
    padding,
    gap: 26,
    photoBox: { maxWidth: OG_WIDTH - padding * 2, maxHeight: 410 },
    infoCompact: false,
    photoFit: 'cover',
  }
}

function fitWithinBox(aspect: number, { maxWidth, maxHeight }: LayoutConfig['photoBox']) {
  let width = maxWidth
  let height = width / aspect
  if (height > maxHeight) {
    height = maxHeight
    width = height * aspect
  }
  return { width, height }
}

function buildExifItems(exifInfo: OgExifInfo | null): Array<{ label: string; text: string }> {
  const items: Array<{ label: string; text: string }> = []
  if (exifInfo?.aperture) {
    items.push({ label: 'f', text: exifInfo.aperture })
  }
  if (exifInfo?.shutterSpeed) {
    items.push({ label: 's', text: exifInfo.shutterSpeed })
  }
  if (exifInfo?.iso) {
    items.push({ label: 'iso', text: `${exifInfo.iso}` })
  }
  if (exifInfo?.focalLength) {
    items.push({ label: 'mm', text: exifInfo.focalLength })
  }
  return items
}

function baseCanvas(padding: number, siteName: string, content: string): string {
  return `<div style="${css({
    width: '100%',
    height: '100%',
    padding,
    position: 'relative',
    backgroundImage: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #0f0f0f 100%)',
    fontFamily: FONT_FAMILY,
    display: 'flex',
  })}">
    <div style="${css({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      opacity: '0.02',
      backgroundImage:
        'linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
      backgroundSize: '48px 48px',
      display: 'flex',
    })}"></div>
    <div style="${css({
      position: 'absolute',
      bottom: 32,
      right: 32,
      fontSize: 20,
      fontWeight: '500',
      color: 'rgba(255,255,255,0.68)',
      letterSpacing: '0.5px',
      display: 'flex',
    })}">${escapeHtml(siteName)} · Afilmory Edge</div>
    <div style="position:relative;width:100%;height:100%;display:flex">${content}</div>
  </div>`
}

function photoFrame(width: number, height: number, fit: 'cover' | 'contain', src: string | null): string {
  if (!src) {
    return `<div style="${css({
      width,
      height,
      borderRadius: 10,
      backgroundColor: '#050505',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    })}"><span style="${css({
      color: 'rgba(255,255,255,0.35)',
      fontSize: 14,
      letterSpacing: '0.3px',
    })}">No Preview</span></div>`
  }

  return `<div style="${css({
    width,
    height,
    position: 'relative',
    borderRadius: 10,
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
    backgroundColor: '#050505',
    display: 'flex',
  })}">
    <img src="${src}" style="${css({ width: '100%', height: '100%', objectFit: fit })}">
    <div style="${css({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 50%)',
      display: 'flex',
    })}"></div>
  </div>`
}

function splitLayout(gap: number, photo: string, info: string): string {
  return `<div style="${css({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap,
    width: '100%',
    height: '100%',
  })}">
    <div style="display:flex;flex-shrink:0">${photo}</div>
    <div style="display:flex;align-items:center;flex:1;height:100%">${info}</div>
  </div>`
}

function stackLayout(gap: number, photo: string, info: string, photoWidth: number, alignCenter: boolean): string {
  return `<div style="${css({
    display: 'flex',
    flexDirection: 'column',
    gap,
    width: '100%',
    height: '100%',
    justifyContent: 'flex-start',
    alignItems: 'center',
  })}">
    <div style="display:flex;justify-content:center;flex-shrink:0">${photo}</div>
    <div style="${css({
      width: '100%',
      maxWidth: photoWidth,
      margin: alignCenter ? '0 auto' : undefined,
      display: 'flex',
      flexShrink: 0,
    })}">${info}</div>
  </div>`
}

interface InfoPanelInput {
  title: string
  tags: string[]
  exifItems: Array<{ label: string; text: string }>
  camera: string | null
  formattedDate?: string
  accentColor: string
  compact: boolean
}

function infoPanel(input: InfoPanelInput): string {
  const { title, tags, exifItems, camera, formattedDate, accentColor, compact } = input
  const tagLimit = compact ? 2 : 3
  const fontScale = compact ? 0.8 : 1

  const tagHtml =
    tags.length > 0
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${tags
          .slice(0, tagLimit)
          .map(
            (tag) =>
              `<div style="${css({
                display: 'flex',
                alignItems: 'center',
                fontSize: 13 * fontScale,
                color: 'rgba(255,255,255,0.9)',
                backgroundColor: 'rgba(255,255,255,0.12)',
                padding: `${compact ? 4 : 6}px ${compact ? 12 : 14}px`,
                borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.15)',
                letterSpacing: '0.2px',
              })}">#${escapeHtml(tag)}</div>`,
          )
          .join('')}</div>`
      : ''

  const cameraHtml = camera
    ? `<div style="${css({
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: 'rgba(255,255,255,0.7)',
        fontSize: 15 * fontScale,
      })}">
      <span style="${css({
        fontSize: 11 * fontScale,
        color: 'rgba(255,255,255,0.45)',
        letterSpacing: '0.3px',
        textTransform: 'uppercase',
      })}">cam</span>
      <span>${escapeHtml(camera)}</span>
    </div>`
    : ''

  const exifHtml =
    exifItems.length > 0
      ? `<div style="${css({
          display: 'flex',
          gap: compact ? 12 : 18,
          color: 'rgba(255,255,255,0.75)',
          fontSize: 14 * fontScale,
          flexWrap: 'wrap',
        })}">${exifItems
          .map(
            (item) => `<div style="display:flex;gap:4px;align-items:center">
          <span style="${css({
            fontSize: 10 * fontScale,
            color: 'rgba(255,255,255,0.35)',
            letterSpacing: '0.2px',
            textTransform: 'uppercase',
          })}">${escapeHtml(item.label)}</span>
          <span>${escapeHtml(item.text)}</span>
        </div>`,
          )
          .join('')}</div>`
      : ''

  const dateHtml = formattedDate
    ? `<div style="${css({
        color: 'rgba(255,255,255,0.45)',
        fontSize: 13 * fontScale,
        marginTop: compact ? 2 : 6,
        display: 'flex',
      })}">${escapeHtml(formattedDate)}</div>`
    : ''

  return `<div style="${css({
    display: 'flex',
    flexDirection: 'column',
    gap: compact ? 12 : 16,
    color: '#ffffff',
  })}">
    <h1 style="${css({
      margin: 0,
      fontSize: compact ? 28 : 40,
      fontWeight: 700,
      letterSpacing: '-0.5px',
      lineHeight: 1.25,
    })}">${escapeHtml(title)}</h1>
    ${tagHtml}
    ${cameraHtml}
    ${exifHtml}
    ${dateHtml}
    <div style="${css({
      width: compact ? 50 : 80,
      height: 3,
      backgroundColor: accentColor,
      borderRadius: 2,
      display: 'flex',
    })}"></div>
  </div>`
}

export function buildPhotoOgHtml(input: PhotoOgInput): string {
  const width =
    Number.isFinite(input.photoDimensions.width) && input.photoDimensions.width > 0 ? input.photoDimensions.width : 1
  const height =
    Number.isFinite(input.photoDimensions.height) && input.photoDimensions.height > 0 ? input.photoDimensions.height : 1
  const aspect = width / height

  const layout = determineLayout(aspect)
  const photoSize = fitWithinBox(aspect, layout.photoBox)
  const photo = photoFrame(photoSize.width, photoSize.height, layout.photoFit, input.thumbnailSrc)
  const info = infoPanel({
    title: input.photoTitle || 'Untitled Photo',
    tags: input.tags,
    exifItems: buildExifItems(input.exifInfo),
    camera: input.exifInfo?.camera ?? null,
    formattedDate: input.formattedDate,
    accentColor: input.accentColor,
    compact: layout.infoCompact,
  })

  const content =
    layout.arrangement === 'split'
      ? splitLayout(layout.gap, photo, info)
      : stackLayout(layout.gap, photo, info, photoSize.width, layout.arrangement === 'wide')

  return baseCanvas(layout.padding, input.siteName, content)
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`
  }
  return num.toString()
}

function statItem(label: string, value: string): string {
  return `<div style="display:flex;flex-direction:column;gap:4px">
    <div style="${css({
      display: 'flex',
      alignItems: 'center',
      color: 'rgba(255,255,255,0.6)',
      fontSize: 14,
      letterSpacing: '0.3px',
    })}">${escapeHtml(label)}</div>
    <div style="${css({
      display: 'flex',
      fontSize: 28,
      fontWeight: 600,
      color: '#ffffff',
      letterSpacing: '-0.5px',
    })}">${escapeHtml(value)}</div>
  </div>`
}

function featuredTile(src: string | null): string {
  const image = src ? `<img src="${src}" style="${css({ width: '100%', height: '100%', objectFit: 'cover' })}">` : ''
  return `<div style="${css({
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#050505',
    position: 'relative',
    display: 'flex',
  })}">
    ${image}
    <div style="${css({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundImage: 'linear-gradient(135deg, rgba(0,0,0,0.3) 0%, transparent 50%)',
      display: 'flex',
    })}"></div>
  </div>`
}

export function buildHomepageOgHtml(input: HomepageOgInput): string {
  const hasAvatar = Boolean(input.authorAvatar)
  const featured = input.featuredPhotos
  const hasFeatured = featured.length > 0

  const featuredGrid = hasFeatured
    ? `<div style="${css({
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        opacity: '0.2',
      })}">
      <div style="display:flex;flex-direction:row;gap:0;flex:1">${featured
        .slice(0, 3)
        .map((photo) => featuredTile(photo.thumbnailSrc))
        .join('')}</div>
      <div style="display:flex;flex-direction:row;gap:0;flex:1">${featured
        .slice(3, 6)
        .map((photo) => featuredTile(photo.thumbnailSrc))
        .join('')}</div>
    </div>
    <div style="${css({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundImage: 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.5) 100%)',
      display: 'flex',
    })}"></div>`
    : ''

  const avatar = hasAvatar
    ? `<div style="display:flex;flex-shrink:0">
      <div style="${css({
        width: 180,
        height: 180,
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
        backgroundColor: '#050505',
        display: 'flex',
        position: 'relative',
      })}">
        <img src="${input.authorAvatar}" style="${css({ width: '100%', height: '100%', objectFit: 'cover' })}">
        <div style="${css({
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 50%)',
          display: 'flex',
        })}"></div>
      </div>
    </div>`
    : ''

  const description = input.siteDescription
    ? `<p style="${css({
        margin: 0,
        fontSize: 22,
        fontWeight: 400,
        lineHeight: 1.4,
        color: 'rgba(255,255,255,0.75)',
        maxWidth: 700,
      })}">${escapeHtml(input.siteDescription)}</p>`
    : ''

  const stats = `<div style="${css({
    display: 'flex',
    gap: 32,
    flexWrap: 'wrap',
    marginTop: 8,
  })}">
    ${statItem('Photos', formatNumber(input.stats.totalPhotos))}
    ${statItem('Tags', formatNumber(input.stats.uniqueTags))}
    ${statItem('Cameras', formatNumber(input.stats.uniqueCameras))}
  </div>`

  const content = `<div style="${css({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: '100%',
    position: 'relative',
  })}">
    ${featuredGrid}
    <div style="${css({
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: hasAvatar ? 48 : 0,
      width: '100%',
      height: '100%',
      position: 'relative',
      padding: 60,
    })}">
      ${avatar}
      <div style="${css({
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        flex: 1,
        height: '100%',
        justifyContent: 'center',
      })}">
        <div style="display:flex;flex-direction:column;gap:12px">
          <h1 style="${css({
            margin: 0,
            fontSize: 56,
            fontWeight: 700,
            letterSpacing: '-1px',
            lineHeight: 1.2,
            color: '#ffffff',
          })}">${escapeHtml(input.siteName)}</h1>
          ${description}
        </div>
        ${stats}
        <div style="${css({
          width: 120,
          height: 4,
          backgroundColor: input.accentColor,
          borderRadius: 2,
          marginTop: 12,
          display: 'flex',
        })}"></div>
      </div>
    </div>
  </div>`

  return baseCanvas(0, input.siteName, content)
}
