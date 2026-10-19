import { redirect } from 'react-router'

import { PhotoPage } from '~/modules/photos'

const VALID_TABS = ['library', 'storage'] as const
const isValidTab = (value: string | undefined): value is (typeof VALID_TABS)[number] =>
  VALID_TABS.includes(value as (typeof VALID_TABS)[number])

export function Component() {
  return <PhotoPage />
}

// eslint-disable-next-line react-refresh/only-export-components
export const loader = ({
  params,
}: {
  params: {
    tab?: string
  }
}) => {
  const { tab } = params

  if (!isValidTab(tab)) {
    return redirect(`/photos/library`)
  }

  return null
}
