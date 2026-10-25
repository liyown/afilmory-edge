/**
 * The upload flow is shared by the desktop modal and the mobile page. On small
 * screens the actions become a sticky footer so the primary button stays
 * reachable without scrolling past the file list; from `sm` up the layout is
 * identical to the modal.
 */
export const STEP_ACTIONS_CLASS =
  'flex items-center justify-end gap-2 max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-4 max-sm:border-t max-sm:border-white/10 max-sm:bg-background/95 max-sm:px-4 max-sm:pt-3 max-sm:pb-[calc(env(safe-area-inset-bottom)+0.75rem)] max-sm:backdrop-blur'

export const STEP_ACTION_BUTTON_CLASS = 'max-sm:flex-1'
