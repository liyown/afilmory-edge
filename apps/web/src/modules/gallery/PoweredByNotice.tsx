import { clsxm } from '@afilmory/utils'
import { repository, version } from '@pkg'

const UPSTREAM_URL = 'https://github.com/Afilmory/Afilmory'
const LICENSE_URL = `${repository.url}/blob/main/LICENSE`

export const PoweredByNotice = ({ className }: { className?: string }) => {
  const source = repository.url.replace(/^https?:\/\/github\.com\//, '')
  const revision = GIT_COMMIT_HASH ? GIT_COMMIT_HASH.slice(0, 7) : 'unknown'

  return (
    <p className={clsxm('text-center leading-relaxed', className)}>
      Powered by{' '}
      <a href={UPSTREAM_URL} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        Afilmory
      </a>{' '}
      — Source (v{version}/{revision}):{' '}
      <a href={repository.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        {source}
      </a>{' '}
      — License: AGPL-3.0-or-later (
      <a href={LICENSE_URL} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        LICENSE
      </a>
      )
    </p>
  )
}
