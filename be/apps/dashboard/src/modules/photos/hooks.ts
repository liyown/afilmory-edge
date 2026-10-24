import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { UploadPhotoAssetsOptions } from './api'
import {
  deletePhotoAssets,
  getPhotoAssetSummary,
  listPhotoAssets,
  updatePhotoAssetTags,
  uploadPhotoAssets,
} from './api'
import type { PhotoAssetListItem } from './types'

export const PHOTO_ASSET_SUMMARY_QUERY_KEY = ['photo-assets', 'summary'] as const
export const PHOTO_ASSET_LIST_QUERY_KEY = ['photo-assets', 'list'] as const

export function usePhotoAssetSummaryQuery() {
  return useQuery({
    queryKey: PHOTO_ASSET_SUMMARY_QUERY_KEY,
    queryFn: getPhotoAssetSummary,
  })
}

export function usePhotoAssetListQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: PHOTO_ASSET_LIST_QUERY_KEY,
    queryFn: listPhotoAssets,
    enabled: options?.enabled ?? true,
  })
}

export function useDeletePhotoAssetsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: { ids: string[]; deleteFromStorage?: boolean }) => {
      await deletePhotoAssets(variables.ids, {
        deleteFromStorage: variables.deleteFromStorage,
      })
    },
    onSuccess: (_, variables) => {
      const { ids } = variables
      void queryClient.invalidateQueries({
        queryKey: PHOTO_ASSET_LIST_QUERY_KEY,
      })
      void queryClient.invalidateQueries({
        queryKey: PHOTO_ASSET_SUMMARY_QUERY_KEY,
      })
      // Optimistically remove deleted ids from cache if available
      queryClient.setQueryData<PhotoAssetListItem[] | undefined>(PHOTO_ASSET_LIST_QUERY_KEY, (previous) => {
        if (!previous) {
          return previous
        }
        const idSet = new Set(ids)
        return previous.filter((item) => !idSet.has(item.id))
      })
    },
  })
}

export function useUploadPhotoAssetsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      files,
      concurrency,
      directory,
      signal,
      onProgress,
      timeoutMs,
      onServerEvent,
    }: {
      files: File[]
      concurrency?: number
      directory?: string | null
      signal?: AbortSignal
      onProgress?: UploadPhotoAssetsOptions['onProgress']
      timeoutMs?: UploadPhotoAssetsOptions['timeoutMs']
      onServerEvent?: UploadPhotoAssetsOptions['onServerEvent']
    }) => {
      return await uploadPhotoAssets(files, {
        concurrency,
        directory: directory ?? undefined,
        signal,
        onProgress,
        timeoutMs,
        onServerEvent,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PHOTO_ASSET_LIST_QUERY_KEY,
      })
      void queryClient.invalidateQueries({
        queryKey: PHOTO_ASSET_SUMMARY_QUERY_KEY,
      })
    },
  })
}

export function useUpdatePhotoTagsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: { id: string; tags: string[] }) => {
      return await updatePhotoAssetTags(variables.id, variables.tags)
    },
    onSuccess: (asset) => {
      queryClient.setQueryData<PhotoAssetListItem[] | undefined>(PHOTO_ASSET_LIST_QUERY_KEY, (previous) => {
        if (!previous) {
          return previous
        }
        return previous.map((item) => (item.id === asset.id ? asset : item))
      })
    },
  })
}
