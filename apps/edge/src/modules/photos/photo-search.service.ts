import { photoAiIndex, photoAssets } from '@afilmory/db'
import { env } from '@afilmory/env'
import { DbAccessor } from '@core/database/database.provider'
import { inArray } from '@core/database/sql-operators'
import { injectable } from 'tsyringe'

import { aiIndexEnabled } from './photo-ai-indexer'

const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3'
const MIN_SCORE = 0.3

export interface PhotoSearchResult {
  photoId: string
  score: number
  tags: string[]
  caption: string | null
}

export interface PhotoSearchResponse {
  enabled: boolean
  degraded: boolean
  query: string
  tookMs: number
  results: PhotoSearchResult[]
}

interface VectorizeResult {
  matches?: Array<{ id: string; score: number }>
}

@injectable()
export class PhotoSearchService {
  constructor(private readonly dbAccessor: DbAccessor) {}

  async search(query: string, limit: number): Promise<PhotoSearchResponse> {
    const started = Date.now()
    const normalized = query.trim()
    if (!normalized) {
      return { enabled: true, degraded: false, query: '', tookMs: 0, results: [] }
    }
    if (!aiIndexEnabled()) {
      return { enabled: false, degraded: true, query: normalized, tookMs: 0, results: [] }
    }

    const model = env.AI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL
    const embedding = (await env.AI!.run(model, { text: [normalized] })) as { data?: unknown }
    const embeddingData = Array.isArray(embedding.data) ? embedding.data : []
    const values = Array.isArray(embeddingData[0])
      ? (embeddingData[0] as number[])
      : embeddingData.every((value) => typeof value === 'number')
        ? (embeddingData as number[])
        : []
    if (values.length !== 1024) {
      return { enabled: true, degraded: true, query: normalized, tookMs: Date.now() - started, results: [] }
    }

    const vectorResult = (await env.VECTORIZE!.query(values, {
      topK: Math.min(limit * 3, 50),
      returnMetadata: 'none',
    })) as VectorizeResult
    const matches = (vectorResult.matches ?? []).filter((match) => match.score >= MIN_SCORE).slice(0, limit)
    if (matches.length === 0) {
      return { enabled: true, degraded: false, query: normalized, tookMs: Date.now() - started, results: [] }
    }

    const db = this.dbAccessor.get()
    const photoIds = matches.map((match) => match.id)
    const assets = await db
      .select({ photoId: photoAssets.photoId })
      .from(photoAssets)
      .where(inArray(photoAssets.photoId, photoIds))
    const liveIds = new Set(assets.map((asset) => asset.photoId))
    const aiRows = await db
      .select({
        photoId: photoAiIndex.photoId,
        tags: photoAiIndex.aiTags,
        caption: photoAiIndex.caption,
      })
      .from(photoAiIndex)
      .where(inArray(photoAiIndex.photoId, photoIds))
    const aiByPhoto = new Map(aiRows.map((row) => [row.photoId, row]))

    return {
      enabled: true,
      degraded: false,
      query: normalized,
      tookMs: Date.now() - started,
      results: matches
        .filter((match) => liveIds.has(match.id))
        .map((match) => ({
          photoId: match.id,
          score: match.score,
          tags: aiByPhoto.get(match.id)?.tags ?? [],
          caption: aiByPhoto.get(match.id)?.caption ?? null,
        })),
    }
  }
}
