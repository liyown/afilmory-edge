import type { PhotoRegion } from '@afilmory/typing'

export function getPhotoRegionId(region: PhotoRegion, index: number) {
  return `${region.name}-${region.type ?? 'region'}-${index}`
}

export function getPhotoRegionIcon(type?: string) {
  switch (type?.toLowerCase()) {
    case 'person':
      return 'i-mingcute-user-3-line'
    case 'object':
      return 'i-mingcute-target-line'
    default:
      return 'i-mingcute-frame-line'
  }
}
