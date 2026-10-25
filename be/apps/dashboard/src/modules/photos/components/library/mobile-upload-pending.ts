export type PendingMobileUpload = {
  files: File[]
  availableTags: string[]
}

let pending: PendingMobileUpload | null = null

export function setPendingMobileUpload(value: PendingMobileUpload): void {
  pending = value
}

export function peekPendingMobileUpload(): PendingMobileUpload | null {
  return pending
}

/** Cleared on unmount so a later visit cannot resurrect stale file handles. */
export function clearPendingMobileUpload(): void {
  pending = null
}
