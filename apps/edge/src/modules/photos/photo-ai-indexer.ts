import { photoAiIndex, photoAssets } from '@afilmory/db'
import { env } from '@afilmory/env'
import { DbAccessor } from '@core/database/database.provider'
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from '@core/database/sql-operators'
import { injectable } from 'tsyringe'

import { storageGet, storageHead } from '../../storage'
import { ManifestPublisher } from './manifest-publisher.service'
import { buildSearchText, mergeDisplayTags, parseVisionOutput, thumbnailKeyFor } from './photo-ai-utils'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const LEASE_MS = 10 * 60 * 1000
const DEFAULT_VISION_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct'
const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3'

interface EmbeddingResult {
  data?: unknown
}

function nowIso(): string {
  return new Date().toISOString()
}

function isoAfter(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

export function aiIndexEnabled(): boolean {
  return env.AI_INDEX_ENABLED !== 'false' && Boolean(env.AI) && Boolean(env.VECTORIZE)
}

function mimeFor(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'avif':
      return 'image/avif'
    case 'heic':
    case 'heif':
      return 'image/heic'
    default:
      return 'image/jpeg'
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x2000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

async function readImage(key: string): Promise<string | null> {
  const object = await storageGet(key)
  if (!object || object.size > MAX_IMAGE_BYTES) {
    return null
  }
  const bytes = new Uint8Array(await object.response.arrayBuffer())
  return `data:${mimeFor(key)};base64,${bytesToBase64(bytes)}`
}

@injectable()
export class PhotoAiIndexer {
  constructor(
    private readonly dbAccessor: DbAccessor,
    private readonly publisher: ManifestPublisher,
  ) {}

  async enqueueAndIndex(assetId: string): Promise<void> {
    if (!aiIndexEnabled()) {
      return
    }
    try {
      await this.ensure(assetId)
      await this.index(assetId)
    } catch (error) {
      console.error('[photo-ai] enqueue failed', { assetId, error: String(error) })
    }
  }

  async ensure(assetId: string): Promise<void> {
    const db = this.dbAccessor.get()
    const [asset] = await db
      .select({ id: photoAssets.id, photoId: photoAssets.photoId })
      .from(photoAssets)
      .where(eq(photoAssets.id, assetId))
      .limit(1)
    if (!asset) {
      return
    }

    await db
      .insert(photoAiIndex)
      .values({
        assetId: asset.id,
        photoId: asset.photoId,
        status: 'pending',
      })
      .onConflictDoNothing()
  }

  async index(assetId: string, options: { force?: boolean } = {}): Promise<'ready' | 'skipped' | 'failed' | 'busy'> {
    if (!aiIndexEnabled()) {
      return 'skipped'
    }

    const db = this.dbAccessor.get()
    const now = nowIso()
    if (options.force) {
      await db
        .update(photoAiIndex)
        .set({
          status: 'pending',
          nextAttemptAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(photoAiIndex.assetId, assetId))
    }

    const [claimed] = await db
      .update(photoAiIndex)
      .set({
        status: 'processing',
        leaseOwner: crypto.randomUUID(),
        leaseExpiresAt: isoAfter(LEASE_MS),
        attempts: sql`${photoAiIndex.attempts} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(photoAiIndex.assetId, assetId),
          or(
            inArray(photoAiIndex.status, ['pending', 'failed', 'skipped']),
            and(eq(photoAiIndex.status, 'processing'), lt(photoAiIndex.leaseExpiresAt, now)),
          ),
        ),
      )
      .returning()

    if (!claimed) {
      return 'busy'
    }

    try {
      const [asset] = await db.select().from(photoAssets).where(eq(photoAssets.id, assetId)).limit(1)
      if (!asset) {
        await this.finish(claimed.id, 'skipped', { lastError: 'asset not found' })
        return 'skipped'
      }

      const thumbKey = thumbnailKeyFor(asset.storageKey)
      const thumb = await storageHead(thumbKey)
      const original = thumb ? null : await storageHead(asset.storageKey)
      const source = thumb ?? original
      if (!source || source.size > MAX_IMAGE_BYTES) {
        await this.finish(claimed.id, 'skipped', {
          lastError: 'no usable image within size limit',
          nextAttemptAt: isoAfter(6 * 60 * 60 * 1000),
        })
        return 'skipped'
      }

      const imageKey = thumb ? thumbKey : asset.storageKey
      const image = await readImage(imageKey)
      if (!image) {
        await this.finish(claimed.id, 'skipped', {
          lastError: 'unable to read image',
          nextAttemptAt: isoAfter(6 * 60 * 60 * 1000),
        })
        return 'skipped'
      }

      const visionModel = env.AI_VISION_MODEL ?? DEFAULT_VISION_MODEL
      const embeddingModel = env.AI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL
      const question =
        'Describe this photo and return ONLY JSON: ' +
        '{"caption":"one concise sentence","tags":["8-12 concrete English keywords"]}. ' +
        'No markdown, no explanation.'
      const vision = visionModel.includes('moondream')
        ? await env.AI!.run(visionModel, {
            task: 'query',
            image,
            question,
            reasoning: false,
            max_tokens: 320,
          })
        : await env.AI!.run(visionModel, {
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: question },
                  { type: 'image_url', image_url: { url: image } },
                ],
              },
            ],
            max_tokens: 320,
            temperature: 0.2,
          })
      const parsed = parseVisionOutput(vision)
      if (!parsed) {
        throw new Error('vision model returned no caption or tags')
      }

      const oldAiTags = claimed.aiTags ?? []
      const aiTags = parsed.tags.length > 0 ? parsed.tags : oldAiTags
      const searchText = buildSearchText(asset.manifest, parsed.caption, aiTags)
      const embedding = (await env.AI!.run(embeddingModel, { text: [searchText] })) as EmbeddingResult
      const embeddingData = Array.isArray(embedding.data) ? embedding.data : []
      const values = Array.isArray(embeddingData[0])
        ? (embeddingData[0] as number[])
        : embeddingData.every((value) => typeof value === 'number')
          ? (embeddingData as number[])
          : []
      if (values.length !== 1024) {
        throw new Error(`embedding has unexpected dimensions: ${values.length}`)
      }

      await env.VECTORIZE!.upsert([
        {
          id: asset.photoId,
          values,
          metadata: { photoId: asset.photoId },
        },
      ])

      await this.mergeTags(asset.id, aiTags)
      await this.finish(claimed.id, 'ready', {
        aiTags,
        caption: parsed.caption,
        searchText,
        sourceHash: `${source.etag ?? ''}:${source.size}`,
        modelVision: visionModel,
        modelEmbedding: embeddingModel,
        indexedAt: nowIso(),
      })
      await this.publisher.publish()
      return 'ready'
    } catch (error) {
      const attempts = Number(claimed.attempts ?? 1)
      const delay = Math.min(attempts * attempts * 60_000, 6 * 60 * 60 * 1000)
      await this.finish(claimed.id, 'failed', {
        lastError: String(error).slice(0, 1000),
        nextAttemptAt: isoAfter(delay),
      })
      console.error('[photo-ai] index failed', { assetId, attempts, error: String(error) })
      return 'failed'
    }
  }

  async backfill(limit = 10): Promise<number> {
    if (!aiIndexEnabled()) {
      return 0
    }
    const db = this.dbAccessor.get()
    const now = nowIso()
    const rows = await db
      .select({ assetId: photoAiIndex.assetId })
      .from(photoAiIndex)
      .where(
        or(
          and(
            inArray(photoAiIndex.status, ['pending', 'failed', 'skipped']),
            or(isNull(photoAiIndex.nextAttemptAt), lte(photoAiIndex.nextAttemptAt, now)),
          ),
          and(eq(photoAiIndex.status, 'processing'), lt(photoAiIndex.leaseExpiresAt, now)),
        ),
      )
      .orderBy(asc(photoAiIndex.nextAttemptAt))
      .limit(limit)

    let indexed = 0
    for (const row of rows) {
      if ((await this.index(row.assetId)) === 'ready') {
        indexed += 1
      }
    }
    return indexed
  }

  async deleteVectors(photoIds: string[]): Promise<void> {
    if (!env.VECTORIZE || !env.AI_INDEX_ENABLED || photoIds.length === 0) {
      return
    }
    try {
      await env.VECTORIZE.deleteByIds(photoIds)
    } catch (error) {
      console.error('[photo-ai] vector delete failed', { photoIds, error: String(error) })
    }
  }

  private async mergeTags(assetId: string, aiTags: string[]): Promise<void> {
    const db = this.dbAccessor.get()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [asset] = await db.select().from(photoAssets).where(eq(photoAssets.id, assetId)).limit(1)
      if (!asset) {
        return
      }
      const oldAi = await db
        .select({ tags: photoAiIndex.aiTags })
        .from(photoAiIndex)
        .where(eq(photoAiIndex.assetId, assetId))
        .limit(1)
      const oldAiTags = oldAi[0]?.tags ?? []
      const oldAiSet = new Set(oldAiTags.map((tag) => tag.toLowerCase()))
      const manualTags = (asset.manifest.data.tags ?? []).filter((tag) => !oldAiSet.has(tag.toLowerCase()))
      const nextTags = mergeDisplayTags(manualTags, aiTags)
      const currentAiTags = asset.manifest.data.aiTags ?? []
      if (
        nextTags.join('\0') === (asset.manifest.data.tags ?? []).join('\0') &&
        currentAiTags.join('\0') === aiTags.join('\0')
      ) {
        return
      }
      const nextManifest = {
        ...asset.manifest,
        data: { ...asset.manifest.data, tags: nextTags, aiTags },
      }
      const updated = await db
        .update(photoAssets)
        .set({
          manifest: nextManifest,
          updatedAt: nowIso(),
        })
        .where(and(eq(photoAssets.id, assetId), eq(photoAssets.manifest, asset.manifest)))
        .returning({ id: photoAssets.id })
      if (updated.length > 0) {
        return
      }
    }
  }

  private async finish(
    id: string,
    status: 'ready' | 'skipped' | 'failed',
    values: {
      aiTags?: string[]
      caption?: string
      searchText?: string
      sourceHash?: string
      modelVision?: string
      modelEmbedding?: string
      indexedAt?: string
      nextAttemptAt?: string
      lastError?: string
    },
  ): Promise<void> {
    const db = this.dbAccessor.get()
    const update: Partial<typeof photoAiIndex.$inferInsert> = {
      status,
      nextAttemptAt: values.nextAttemptAt ?? null,
      lastError: values.lastError ?? null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: nowIso(),
    }
    if (values.aiTags !== undefined) update.aiTags = values.aiTags
    if (values.caption !== undefined) update.caption = values.caption
    if (values.searchText !== undefined) update.searchText = values.searchText
    if (values.sourceHash !== undefined) update.sourceHash = values.sourceHash
    if (values.modelVision !== undefined) update.modelVision = values.modelVision
    if (values.modelEmbedding !== undefined) update.modelEmbedding = values.modelEmbedding
    if (values.indexedAt !== undefined) update.indexedAt = values.indexedAt

    await db.update(photoAiIndex).set(update).where(eq(photoAiIndex.id, id))
  }
}
