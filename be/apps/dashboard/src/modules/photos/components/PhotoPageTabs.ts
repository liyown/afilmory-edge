export type PhotoPageTab = 'library' | 'storage'

export const PHOTO_TABS: readonly PhotoPageTab[] = ['library', 'storage'] as const

export const TAB_ROUTE_MAP: Record<PhotoPageTab, string> = {
  library: '/photos/library',
  storage: '/photos/storage',
}
