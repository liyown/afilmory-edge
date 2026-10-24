import * as AvatarPrimitive from '@radix-ui/react-avatar'

import { siteConfig } from '~/config'
import { usePhotos } from '~/hooks/usePhotoViewer'

import { resolveSocialUrl, SocialIconButton } from './utils'

export const PageHeaderLeft = () => {
  const visiblePhotoCount = usePhotos().length

  const githubUrl =
    siteConfig.social && siteConfig.social.github
      ? resolveSocialUrl(siteConfig.social.github, { baseUrl: 'https://github.com/' })
      : undefined
  const twitterUrl =
    siteConfig.social && siteConfig.social.twitter
      ? resolveSocialUrl(siteConfig.social.twitter, { baseUrl: 'https://twitter.com/', stripAt: true })
      : undefined
  const hasRss = true

  return (
    <div className="flex items-center gap-2">
      {siteConfig.author.avatar ? (
        <AvatarPrimitive.Root>
          <AvatarPrimitive.Image
            src={siteConfig.author.avatar}
            className="size-6 rounded-full lg:size-7"
            alt={siteConfig.author.name}
          />
          <AvatarPrimitive.Fallback>
            <div className="flex size-6 items-center justify-center rounded-full bg-white/10 lg:size-7">
              <i className="i-mingcute-camera-2-line text-sm text-white/60 lg:text-base" />
            </div>
          </AvatarPrimitive.Fallback>
        </AvatarPrimitive.Root>
      ) : (
        <div className="flex size-6 items-center justify-center rounded-full bg-white/10 lg:size-7">
          <i className="i-mingcute-camera-2-line text-sm text-white/60 lg:text-base" />
        </div>
      )}
      <div className="flex items-baseline gap-2">
        <span className="truncate text-[12px] font-medium tracking-[0.14em] text-white/90 uppercase lg:text-[13px]">
          {siteConfig.name}
        </span>
        <span className="font-mono text-[10px] tracking-[0.12em] text-white/35 tabular-nums">{visiblePhotoCount}</span>
      </div>
      {(githubUrl || twitterUrl || hasRss) && (
        <div className="ml-1 hidden items-center gap-1 border-l border-white/10 pl-2 lg:flex">
          {githubUrl && <SocialIconButton icon="i-mingcute-github-fill" title="GitHub" href={githubUrl} />}
          {twitterUrl && <SocialIconButton icon="i-mingcute-twitter-fill" title="Twitter" href={twitterUrl} />}
          {hasRss && <SocialIconButton icon="i-mingcute-rss-2-fill" title="RSS" href="/feed.xml" />}
        </div>
      )}
    </div>
  )
}
