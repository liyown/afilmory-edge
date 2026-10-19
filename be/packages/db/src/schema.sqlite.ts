import { CURRENT_MANIFEST_VERSION } from '@afilmory/builder/manifest/version.js'
import { sql } from 'drizzle-orm'
import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// `nodejs-snowflake` ships a WASM binary loaded through `__dirname`, which does
// not exist in workerd. Keep the same 64-bit, time-sortable shape with Web APIs.
const SNOWFLAKE_EPOCH_MS = 1_759_572_127_000
const WORKER_ID = crypto.getRandomValues(new Uint16Array(1))[0] % 1024
let lastTimestamp = 0
let sequence = 0

export function generateId(): string {
  const now = Date.now()
  if (now === lastTimestamp) {
    sequence = (sequence + 1) % 4096
  }
  else {
    lastTimestamp = now
    sequence = 0
  }

  return ((BigInt(now - SNOWFLAKE_EPOCH_MS) << 22n) | (BigInt(WORKER_ID) << 12n) | BigInt(sequence)).toString()
}

const snowflakeId = text('id')
  .primaryKey()
  .$defaultFn(() => generateId())

// ISO-8601 text keeps the existing `new Date().toISOString()` call sites working
// and sorts correctly as text in SQLite.
const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

function createdAt(name = 'created_at') {
  return text(name).notNull().default(nowIso)
}

function updatedAt(name = 'updated_at') {
  return text(name).notNull().default(nowIso)
}

// The Worker build must not pull the whole builder package just for these
// shared types; the shapes only need to match at the column boundary.
export type ManifestVersion = string
// eslint-disable-next-line ts/no-explicit-any
export type PhotoManifestItem = any

export const CURRENT_PHOTO_MANIFEST_VERSION: ManifestVersion = CURRENT_MANIFEST_VERSION
export const DATABASE_ONLY_PROVIDER = 'database-only'

export type TenantStatus = 'pending' | 'active' | 'inactive' | 'suspended'
export type TenantMembershipRole = 'member' | 'admin' | 'owner'
export type TenantMembershipStatus = 'active' | 'suspended'
export type PlatformRole = 'user' | 'superadmin'
export type PhotoSyncStatus = 'pending' | 'synced' | 'conflict'
export type CommentStatus = 'pending' | 'approved' | 'rejected' | 'hidden'

export type PhotoAssetConflictType = 'missing-in-storage' | 'metadata-mismatch' | 'photo-id-conflict'

export interface PhotoAssetConflictSnapshot {
  size: number | null
  etag: string | null
  lastModified: string | null
  metadataHash: string | null
}

export interface PhotoAssetConflictPayload {
  type: PhotoAssetConflictType
  storageSnapshot?: PhotoAssetConflictSnapshot | null
  recordSnapshot?: PhotoAssetConflictSnapshot | null
  incomingStorageKey?: string | null
}

export interface PhotoAssetManifest {
  version: ManifestVersion
  data: PhotoManifestItem
}

export interface PhotoSyncRunSummary {
  storageObjects: number
  databaseRecords: number
  inserted: number
  updated: number
  deleted: number
  conflicts: number
  skipped: number
  errors: number
}

export const tenants = sqliteTable(
  'tenant',
  {
    id: snowflakeId,
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    planId: text('plan_id').notNull().default('free'),
    storagePlanId: text('storage_plan_id'),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    status: text('status').$type<TenantStatus>().notNull().default('inactive'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex('uq_tenant_slug').on(t.slug)],
)

export const authUsers = sqliteTable(
  'auth_user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    creemCustomerId: text('creem_customer_id'),
    hadTrial: integer('had_trial', { mode: 'boolean' }).notNull().default(false),
    role: text('role').$type<PlatformRole>().notNull().default('user'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' }).notNull().default(false),
    username: text('username'),
    displayUsername: text('display_username'),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: text('ban_expires_at'),
    deletionRequestedAt: text('deletion_requested_at'),
    lastSignedInAt: text('last_signed_in_at'),
    lastActiveAt: text('last_active_at'),
    lastActiveSurface: text('last_active_surface'),
  },
  t => [uniqueIndex('uq_auth_user_email_normalized').on(sql`lower(trim(${t.email}))`)],
)

export const tenantMemberships = sqliteTable(
  'tenant_membership',
  {
    id: snowflakeId,
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: text('role').$type<TenantMembershipRole>().notNull().default('member'),
    status: text('status').$type<TenantMembershipStatus>().notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    uniqueIndex('uq_tenant_membership_tenant_user').on(t.tenantId, t.userId),
    uniqueIndex('uq_tenant_membership_active_owner')
      .on(t.tenantId)
      .where(sql`${t.role} = 'owner' and ${t.status} = 'active'`),
    index('idx_tenant_membership_user_status').on(t.userId, t.status),
    index('idx_tenant_membership_tenant_role_status').on(t.tenantId, t.role, t.status),
  ],
)

export const authSessions = sqliteTable('auth_session', {
  id: text('id').primaryKey(),
  expiresAt: text('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  impersonatedBy: text('impersonated_by'),
  activeTenantId: text('active_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  userId: text('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
})

export const authAccounts = sqliteTable(
  'auth_account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: text('access_token_expires_at'),
    refreshTokenExpiresAt: text('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    uniqueIndex('uq_auth_account_provider').on(t.providerId, t.accountId),
    index('idx_auth_account_user').on(t.userId),
  ],
)

export const authVerifications = sqliteTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const settings = sqliteTable(
  'settings',
  {
    id: snowflakeId,
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    isSensitive: integer('is_sensitive', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex('uq_settings_tenant_key').on(t.tenantId, t.key)],
)

export const systemSettings = sqliteTable(
  'system_setting',
  {
    id: snowflakeId,
    key: text('key').notNull(),
    value: text('value', { mode: 'json' }).$type<unknown | null>().default(null),
    isSensitive: integer('is_sensitive', { mode: 'boolean' }).notNull().default(false),
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex('uq_system_setting_key').on(t.key)],
)

export const reactions = sqliteTable(
  'reactions',
  {
    id: snowflakeId,
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    refKey: text('ref_key').notNull(),
    reaction: text('reaction').notNull(),
  },
  t => [index('idx_reactions_tenant_ref_key').on(t.tenantId, t.refKey)],
)

export const comments = sqliteTable(
  'comment',
  {
    id: snowflakeId,
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    photoId: text('photo_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    content: text('content').notNull(),
    status: text('status').$type<CommentStatus>().notNull().default('approved'),
    userAgent: text('user_agent'),
    clientIp: text('client_ip'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: text('deleted_at'),
  },
  t => [
    foreignKey({
      name: 'fk_comment_parent',
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete('set null'),
    index('idx_comment_tenant_photo').on(t.tenantId, t.photoId),
    index('idx_comment_parent').on(t.parentId),
    index('idx_comment_user').on(t.userId),
  ],
)

export const commentReactions = sqliteTable(
  'comment_reaction',
  {
    id: snowflakeId,
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    commentId: text('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    reaction: text('reaction').notNull(),
    createdAt: createdAt(),
  },
  t => [
    uniqueIndex('uq_comment_reaction_user').on(t.tenantId, t.commentId, t.userId, t.reaction),
    index('idx_comment_reaction_comment').on(t.tenantId, t.commentId),
  ],
)

export const photoAssets = sqliteTable(
  'photo_asset',
  {
    id: snowflakeId,
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    photoId: text('photo_id').notNull(),
    storageKey: text('storage_key').notNull(),
    storageProvider: text('storage_provider').notNull(),
    size: integer('size'),
    etag: text('etag'),
    lastModified: text('last_modified'),
    metadataHash: text('metadata_hash'),
    manifestVersion: text('manifest_version').notNull().default(CURRENT_PHOTO_MANIFEST_VERSION),
    manifest: text('manifest', { mode: 'json' }).$type<PhotoAssetManifest>().notNull(),
    syncStatus: text('sync_status').$type<PhotoSyncStatus>().notNull().default('pending'),
    conflictReason: text('conflict_reason'),
    conflictPayload: text('conflict_payload', { mode: 'json' }).$type<PhotoAssetConflictPayload | null>().default(null),
    syncedAt: text('synced_at').notNull().default(nowIso),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    uniqueIndex('uq_photo_asset_tenant_storage_key').on(t.tenantId, t.storageKey),
    uniqueIndex('uq_photo_asset_tenant_photo_id').on(t.tenantId, t.photoId),
    index('idx_photo_asset_tenant_synced').on(t.tenantId, t.syncedAt),
  ],
)

export const tenantManifestStates = sqliteTable('tenant_manifest_state', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull().default(0),
  updatedAt: updatedAt(),
})

export type ManifestChangeOperation = 'upsert' | 'delete'

export type ManifestChangePayload = {
  operation: ManifestChangeOperation
  photoId: string
  assetId: string | null
  published: boolean
  photo: PhotoManifestItem | null
  asset: {
    id: string
    photoId: string
    storageKey: string
    storageProvider: string
    syncStatus: PhotoSyncStatus
    size: number | null
    createdAt: string
    updatedAt: string
    syncedAt: string
    publicUrl: string | null
  } | null
}

export const tenantManifestChanges = sqliteTable(
  'tenant_manifest_change',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    operation: text('operation').$type<ManifestChangeOperation>().notNull(),
    photoId: text('photo_id').notNull(),
    payload: text('payload', { mode: 'json' }).$type<ManifestChangePayload>().notNull(),
    createdAt: createdAt(),
  },
  t => [
    uniqueIndex('uq_tenant_manifest_change_revision').on(t.tenantId, t.revision),
    index('idx_tenant_manifest_change_tenant_revision').on(t.tenantId, t.revision),
  ],
)

export const photoSyncRuns = sqliteTable(
  'photo_sync_run',
  {
    id: snowflakeId,
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dryRun: integer('dry_run', { mode: 'boolean' }).notNull().default(false),
    summary: text('summary', { mode: 'json' }).$type<PhotoSyncRunSummary>().notNull(),
    actionsCount: integer('actions_count').notNull().default(0),
    startedAt: text('started_at').notNull().default(nowIso),
    completedAt: text('completed_at').notNull().default(nowIso),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index('idx_photo_sync_run_tenant').on(t.tenantId)],
)

export const dbSchema = {
  tenants,
  authUsers,
  tenantMemberships,
  authSessions,
  authAccounts,
  authVerifications,
  settings,
  systemSettings,
  reactions,
  comments,
  commentReactions,
  photoAssets,
  tenantManifestStates,
  tenantManifestChanges,
  photoSyncRuns,
}

export type SQLiteDBSchema = typeof dbSchema
export type DBSchema = SQLiteDBSchema
