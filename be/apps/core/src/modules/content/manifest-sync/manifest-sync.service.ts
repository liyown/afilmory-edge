import type { PhotoManifestItem } from '@afilmory/builder'
import type { ManifestChangePayload } from '@afilmory/db'
import { photoAssets, tenantManifestChanges, tenantManifestStates } from '@afilmory/db'
import type { AtomicPlan } from '@core/database/atomic'
import { DbAccessor } from '@core/database/database.provider'
import type { DrizzleDb } from '@core/database/tokens'
import { requireTenantContext } from '@core/modules/platform/tenant/tenant.context'
import { EventEmitterService } from '@tsuki-hono/event-emitter'
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'

import type { PhotoChange } from './manifest-sync.types'
import {
  isChangeCursorExpired,
  isPublishedSyncStatus,
  MANIFEST_CHANGE_PAGE_SIZE,
  MANIFEST_CHANGE_RETENTION,
  toPhotoChange,
} from './manifest-sync.types'

type PhotoAssetRow = typeof photoAssets.$inferSelect

export type AppliedManifestAction = {
  type: string
  applied: boolean
  photoId: string | null
  storageKey: string
}

export type ManifestChangeDraft
  = | {
    operation: 'upsert'
    record: PhotoAssetRow
    publicUrl?: string | null
  }
  | {
    operation: 'delete'
    photoId: string
    assetId?: string | null
  }

@injectable()
export class ManifestSyncService {
  constructor(
    private readonly dbAccessor: DbAccessor,
    private readonly eventEmitter: EventEmitterService,
  ) {}

  async getRevision(tenantId?: string): Promise<number> {
    const id = tenantId ?? requireTenantContext().tenant.id
    const db = this.dbAccessor.get()
    const [row] = await db
      .select({ revision: tenantManifestStates.revision })
      .from(tenantManifestStates)
      .where(eq(tenantManifestStates.tenantId, id))
      .limit(1)
    return row?.revision ?? 0
  }

  async listChanges(
    after: number,
    tenantId?: string,
  ): Promise<{
    revision: number
    expired: boolean
    changes: PhotoChange[]
  }> {
    const id = tenantId ?? requireTenantContext().tenant.id
    const db = this.dbAccessor.get()
    const revision = await this.getRevision(id)
    if (after >= revision) {
      return { revision, expired: false, changes: [] }
    }

    const [oldest] = await db
      .select({ revision: tenantManifestChanges.revision })
      .from(tenantManifestChanges)
      .where(eq(tenantManifestChanges.tenantId, id))
      .orderBy(asc(tenantManifestChanges.revision))
      .limit(1)

    if (isChangeCursorExpired(after, oldest?.revision ?? null)) {
      return { revision, expired: true, changes: [] }
    }

    const rows = await db
      .select()
      .from(tenantManifestChanges)
      .where(and(eq(tenantManifestChanges.tenantId, id), gt(tenantManifestChanges.revision, after)))
      .orderBy(asc(tenantManifestChanges.revision))
      .limit(MANIFEST_CHANGE_PAGE_SIZE)

    return {
      revision,
      expired: false,
      changes: rows.map(row => toPhotoChange({ tenantId: id, revision: row.revision, payload: row.payload })),
    }
  }

  async recordDrafts(tenantId: string, drafts: ManifestChangeDraft[]): Promise<PhotoChange[]> {
    if (drafts.length === 0) {
      return []
    }
    const changes = await this.dbAccessor.runAtomically(tx => this.createDraftPlan(tx, tenantId, drafts))
    this.emitChanged(tenantId, changes)
    return changes
  }

  emitChanged(tenantId: string, changes: PhotoChange[]): void {
    const latest = changes.at(-1)
    if (!latest) {
      return
    }
    void this.eventEmitter.emit('photo.manifest.changed', { tenantId, revision: latest.revision })
  }

  async recordUpsert(record: PhotoAssetRow, publicUrl?: string | null): Promise<PhotoChange> {
    const [change] = await this.recordDrafts(record.tenantId, [{ operation: 'upsert', record, publicUrl }])
    return change
  }

  async recordDeletes(tenantId: string, records: Array<{ id: string, photoId: string }>): Promise<PhotoChange[]> {
    return await this.recordDrafts(
      tenantId,
      records.map(record => ({
        operation: 'delete' as const,
        photoId: record.photoId,
        assetId: record.id,
      })),
    )
  }

  async recordAppliedActions(tenantId: string, actions: AppliedManifestAction[]): Promise<PhotoChange[]> {
    const applied = actions.filter(
      action => action.applied && (action.type === 'insert' || action.type === 'update' || action.type === 'delete'),
    )
    if (applied.length === 0) {
      return []
    }

    const db = this.dbAccessor.get()
    const photoIds = [...new Set(applied.map(action => action.photoId).filter((id): id is string => Boolean(id)))]
    const records
      = photoIds.length === 0
        ? []
        : await db
            .select()
            .from(photoAssets)
            .where(and(eq(photoAssets.tenantId, tenantId), inArray(photoAssets.photoId, photoIds)))
    const recordsByPhotoId = new Map(records.map(record => [record.photoId, record]))

    const drafts: ManifestChangeDraft[] = []
    for (const action of applied) {
      if (action.type === 'delete') {
        drafts.push({
          operation: 'delete',
          photoId: action.photoId ?? action.storageKey,
          assetId: null,
        })
        continue
      }
      const record = action.photoId ? recordsByPhotoId.get(action.photoId) : undefined
      if (!record) {
        continue
      }
      drafts.push({ operation: 'upsert', record })
    }

    return await this.recordDrafts(tenantId, drafts)
  }

  /**
   * Builds the full atomic plan without reading the database: the revision is
   * allocated by a single UPDATE, and each change row derives its revision from
   * the already-updated state row inside the same transaction/batch.
   */
  createDraftPlan(tx: DrizzleDb, tenantId: string, drafts: ManifestChangeDraft[]): AtomicPlan<PhotoChange[]> {
    const now = new Date().toISOString()
    const count = drafts.length
    const payloads = drafts.map(draft => this.createPayload(draft))

    const currentRevision = sql<number>`(
      select ${tenantManifestStates.revision}
      from ${tenantManifestStates}
      where ${tenantManifestStates.tenantId} = ${tenantId}
    )`

    const statements: unknown[] = [
      tx.insert(tenantManifestStates).values({ tenantId, revision: 0, updatedAt: now }).onConflictDoNothing(),
      tx
        .update(tenantManifestStates)
        .set({
          revision: sql`${tenantManifestStates.revision} + ${count}`,
          updatedAt: now,
        })
        .where(eq(tenantManifestStates.tenantId, tenantId))
        .returning({ revision: tenantManifestStates.revision }),
    ]

    for (const [index, payload] of payloads.entries()) {
      statements.push(
        tx.insert(tenantManifestChanges).values({
          tenantId,
          revision: sql`${currentRevision} - ${count - 1 - index}`,
          operation: payload.operation,
          photoId: payload.photoId,
          payload,
          createdAt: now,
        }),
      )
    }

    statements.push(
      tx
        .delete(tenantManifestChanges)
        .where(
          and(
            eq(tenantManifestChanges.tenantId, tenantId),
            lte(tenantManifestChanges.revision, sql`${currentRevision} - ${MANIFEST_CHANGE_RETENTION}`),
          ),
        ),
    )

    return {
      statements,
      resolve: (results) => {
        const [state] = (results[1] ?? []) as Array<{ revision: number }>
        if (!state) {
          throw new Error(`Failed to allocate manifest revision for tenant ${tenantId}`)
        }

        return payloads.map((payload, index) =>
          toPhotoChange({
            tenantId,
            revision: state.revision - (count - 1 - index),
            payload,
          }))
      },
    }
  }

  private createPayload(draft: ManifestChangeDraft): ManifestChangePayload {
    if (draft.operation === 'delete') {
      return {
        operation: 'delete',
        photoId: draft.photoId,
        assetId: draft.assetId ?? null,
        published: false,
        photo: null,
        asset: null,
      }
    }

    const photo = structuredClone(draft.record.manifest.data) as PhotoManifestItem
    const published = isPublishedSyncStatus(draft.record.syncStatus)
    return {
      operation: 'upsert',
      photoId: draft.record.photoId,
      assetId: draft.record.id,
      published,
      photo,
      asset: {
        id: draft.record.id,
        photoId: draft.record.photoId,
        storageKey: draft.record.storageKey,
        storageProvider: draft.record.storageProvider,
        syncStatus: draft.record.syncStatus,
        size: draft.record.size ?? null,
        createdAt: draft.record.createdAt,
        updatedAt: draft.record.updatedAt,
        syncedAt: draft.record.syncedAt,
        publicUrl: draft.publicUrl ?? photo.originalUrl ?? null,
      },
    }
  }
}
