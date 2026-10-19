import { photoAssets } from '@afilmory/db'
import { DbAccessor } from '@core/database/database.provider'
import { desc, eq, sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'

import { requireTenantContext } from '../tenant/tenant.context'
import type {
  DashboardAnalytics,
  DashboardOverview,
  DashboardRecentActivityItem,
  DashboardStorageProviderUsage,
} from './dashboard.types'

const ZERO_STATS = {
  totalPhotos: 0,
  totalStorageBytes: 0,
  thisMonthUploads: 0,
  previousMonthUploads: 0,
  sync: {
    synced: 0,
    pending: 0,
    conflicts: 0,
  },
} as const

@injectable()
export class DashboardService {
  constructor(private readonly dbAccessor: DbAccessor) {}

  async getOverview(): Promise<DashboardOverview> {
    const tenant = requireTenantContext()
    const db = this.dbAccessor.get()

    const [rawStats] = await db
      .select({
        totalPhotos: sql<number>`count(*)`,
        totalStorageBytes: sql<number>`coalesce(sum(${photoAssets.size}), 0)`,
        // D1 is SQLite: timestamps are ISO text, so compare their YYYY-MM prefix.
        thisMonthUploads: sql<number>`coalesce(sum(case when substr(${photoAssets.createdAt}, 1, 7) = strftime('%Y-%m', 'now') then 1 else 0 end), 0)`,
        previousMonthUploads: sql<number>`coalesce(sum(case when substr(${photoAssets.createdAt}, 1, 7) = strftime('%Y-%m', 'now', '-1 month') then 1 else 0 end), 0)`,
        synced: sql<number>`coalesce(sum(case when ${photoAssets.syncStatus} = 'synced' then 1 else 0 end), 0)`,
        pending: sql<number>`coalesce(sum(case when ${photoAssets.syncStatus} = 'pending' then 1 else 0 end), 0)`,
        conflicts: sql<number>`coalesce(sum(case when ${photoAssets.syncStatus} = 'conflict' then 1 else 0 end), 0)`,
      })
      .from(photoAssets)
      .where(eq(photoAssets.tenantId, tenant.tenant.id))

    const stats = rawStats
      ? {
          totalPhotos: Number(rawStats.totalPhotos ?? 0),
          totalStorageBytes: Number(rawStats.totalStorageBytes ?? 0),
          thisMonthUploads: Number(rawStats.thisMonthUploads ?? 0),
          previousMonthUploads: Number(rawStats.previousMonthUploads ?? 0),
          sync: {
            synced: Number(rawStats.synced ?? 0),
            pending: Number(rawStats.pending ?? 0),
            conflicts: Number(rawStats.conflicts ?? 0),
          },
        }
      : { ...ZERO_STATS }

    const recentRecords = await db
      .select({
        id: photoAssets.id,
        photoId: photoAssets.photoId,
        createdAt: photoAssets.createdAt,
        storageProvider: photoAssets.storageProvider,
        manifest: photoAssets.manifest,
        size: photoAssets.size,
        syncStatus: photoAssets.syncStatus,
      })
      .from(photoAssets)
      .where(eq(photoAssets.tenantId, tenant.tenant.id))
      .orderBy(desc(photoAssets.createdAt))
      .limit(8)

    const recentActivity: DashboardRecentActivityItem[] = recentRecords.map((record) => {
      const { manifest } = record
      const manifestData = manifest?.data
      const tags = manifestData?.tags?.slice(0, 5) ?? []

      return {
        id: record.id,
        photoId: record.photoId,
        title: manifestData?.title?.trim() || manifestData?.description?.trim() || record.photoId,
        description: manifestData?.description?.trim() || null,
        createdAt: record.createdAt,
        takenAt: manifestData?.dateTaken ?? null,
        storageProvider: record.storageProvider,
        size: record.size ?? null,
        syncStatus: record.syncStatus,
        tags,
        previewUrl: manifestData?.thumbnailUrl ?? manifestData?.originalUrl ?? null,
      }
    })

    return {
      stats,
      recentActivity,
    }
  }

  async getAnalytics(): Promise<DashboardAnalytics> {
    const tenant = requireTenantContext()
    const db = this.dbAccessor.get()

    const uploadTrendResult = await db.execute<{ month: string | null, uploads: number | null }>(sql`
      with recursive months(month_start) as (
        select strftime('%Y-%m', 'now', 'start of month', '-11 months')
        union all
        select strftime('%Y-%m', month_start || '-01', '+1 month')
        from months
        where month_start < strftime('%Y-%m', 'now', 'start of month')
      )
      select months.month_start as month,
             coalesce(upload_counts.uploads, 0) as uploads
      from months
      left join (
        select substr(${photoAssets.createdAt}, 1, 7) as month,
               count(*) as uploads
        from ${photoAssets}
        where ${photoAssets.tenantId} = ${tenant.tenant.id}
          and substr(${photoAssets.createdAt}, 1, 7) >= strftime('%Y-%m', 'now', 'start of month', '-11 months')
        group by month
      ) as upload_counts on upload_counts.month = months.month_start
      order by months.month_start
    `)

    const uploadTrends = uploadTrendResult.rows.map(row => ({
      month: row.month ?? '',
      uploads: Number(row.uploads ?? 0),
    }))

    const [storageAggregate] = await db
      .select({
        totalBytes: sql<number>`coalesce(sum(${photoAssets.size}), 0)`,
        totalPhotos: sql<number>`count(*)`,
        currentMonthBytes: sql<number>`coalesce(sum(case when substr(${photoAssets.createdAt}, 1, 7) = strftime('%Y-%m', 'now') then ${photoAssets.size} else 0 end), 0)`,
        previousMonthBytes: sql<number>`coalesce(sum(case when substr(${photoAssets.createdAt}, 1, 7) = strftime('%Y-%m', 'now', '-1 month') then ${photoAssets.size} else 0 end), 0)`,
      })
      .from(photoAssets)
      .where(eq(photoAssets.tenantId, tenant.tenant.id))

    const providerUsageRaw = await db
      .select({
        provider: photoAssets.storageProvider,
        bytes: sql<number>`coalesce(sum(${photoAssets.size}), 0)`,
        photoCount: sql<number>`count(*)`,
      })
      .from(photoAssets)
      .where(eq(photoAssets.tenantId, tenant.tenant.id))
      .groupBy(photoAssets.storageProvider)

    const providers: DashboardStorageProviderUsage[] = providerUsageRaw
      .map(entry => ({
        provider: (entry.provider ?? 'unknown').trim() || 'unknown',
        bytes: Number(entry.bytes ?? 0),
        photoCount: Number(entry.photoCount ?? 0),
      }))
      .sort((a, b) => b.bytes - a.bytes)

    const popularTagsResult = await db.execute<{ tag: string | null, count: number | null }>(sql`
      select tag, count(*) as count
      from (
        select nullif(trim(tag_value.value), '') as tag
        from ${photoAssets}, json_each(json_extract(${photoAssets.manifest}, '$.data.tags')) as tag_value
        where ${photoAssets.tenantId} = ${tenant.tenant.id}
      ) as tag_items
      where tag is not null
      group by tag
      order by count desc
      limit 8
    `)

    const popularTags = popularTagsResult.rows
      .map((row) => {
        const tag = row.tag?.trim()
        if (!tag) {
          return null
        }
        return {
          tag,
          count: Number(row.count ?? 0),
        }
      })
      .filter((value): value is { tag: string, count: number } => value !== null)

    const topDevicesRaw = await db.execute<{ make: string | null, model: string | null, count: number | null }>(sql`
      select
        nullif(trim(json_extract(${photoAssets.manifest}, '$.data.exif.Make')), '') as make,
        nullif(trim(json_extract(${photoAssets.manifest}, '$.data.exif.Model')), '') as model,
        count(*) as count
      from ${photoAssets}
      where ${photoAssets.tenantId} = ${tenant.tenant.id}
      group by make, model
      order by count desc
      limit 20
    `)

    const deviceCounter = new Map<string, number>()
    for (const row of topDevicesRaw.rows) {
      const make = row.make ?? ''
      const model = row.model ?? ''
      let name = model || make

      if (make && model) {
        const lowerMake = make.toLowerCase()
        const lowerModel = model.toLowerCase()
        name = lowerModel.includes(lowerMake) ? model : `${make} ${model}`
      }

      name = name.trim()
      if (!name) {
        continue
      }
      const existing = deviceCounter.get(name) ?? 0
      deviceCounter.set(name, existing + Number(row.count ?? 0))
    }

    const topDevices = Array.from(deviceCounter.entries())
      .map(([device, count]) => ({ device, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    return {
      uploadTrends,
      storageUsage: {
        totalBytes: Number(storageAggregate?.totalBytes ?? 0),
        totalPhotos: Number(storageAggregate?.totalPhotos ?? 0),
        currentMonthBytes: Number(storageAggregate?.currentMonthBytes ?? 0),
        previousMonthBytes: Number(storageAggregate?.previousMonthBytes ?? 0),
        providers,
      },
      popularTags,
      topDevices,
    }
  }
}
