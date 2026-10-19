import { photoLoader } from '@afilmory/data'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { apiFetch } from '~/lib/api/http'

export interface SemanticSearchHit {
  photoId: string
  score: number
  tags: string[]
  caption: string | null
}

interface SemanticSearchResponse {
  enabled: boolean
  degraded: boolean
  query: string
  tookMs: number
  results: SemanticSearchHit[]
}

export interface SemanticSearchState {
  ids: Set<string> | null
  isPending: boolean
  degraded: boolean
}

function localSearch(query: string): Set<string> {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return new Set()
  }
  return new Set(
    photoLoader
      .getPhotos()
      .filter((photo) => {
        const location = photo.location
        const locationText = [location?.locationName, location?.city, location?.country]
          .filter((value): value is string => typeof value === 'string')
          .join(' ')
        const haystack = [
          photo.title,
          photo.description,
          ...(photo.tags ?? []),
          photo.exif?.Make,
          photo.exif?.Model,
          photo.exif?.LensModel,
          locationText,
        ]
          .filter((value): value is string => typeof value === 'string')
          .join(' ')
          .toLowerCase()
        return haystack.includes(needle)
      })
      .map((photo) => photo.id),
  )
}

export function useSemanticSearch(query: string): SemanticSearchState {
  const normalized = query.trim()
  const [debounced, setDebounced] = useState(normalized)

  useEffect(() => {
    const timer = setTimeout(setDebounced, 350, normalized)
    return () => clearTimeout(timer)
  }, [normalized])

  const request = useQuery({
    queryKey: ['semantic-search', debounced],
    queryFn: () => apiFetch<SemanticSearchResponse>(`/api/photos/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
    retry: 1,
  })

  if (normalized.length === 0) {
    return { ids: null, isPending: false, degraded: false }
  }

  if (normalized.length < 2) {
    return { ids: localSearch(normalized), isPending: false, degraded: false }
  }

  if (request.isPending) {
    return { ids: null, isPending: true, degraded: false }
  }

  if (request.isError || !request.data?.enabled) {
    return { ids: localSearch(normalized), isPending: false, degraded: true }
  }

  return {
    ids: new Set(request.data.results.map((result) => result.photoId)),
    isPending: false,
    degraded: request.data.degraded,
  }
}
