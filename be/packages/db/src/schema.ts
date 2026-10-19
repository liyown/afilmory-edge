import { CURRENT_MANIFEST_VERSION } from '@afilmory/typing'
import { sql } from 'drizzle-orm'
import { customType, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// `nodejs-snowflake` ships a WASM binary loaded through `__dirname`, which does
// not exist in workerd. Keep the same 64-bit, time-sortable shape with Web APIs.
const SNOWFLAKE_EPOCH_MS = 1_759_572_127_000
// Initialized on first use: workerd forbids random-value generation in global scope.
let workerId: number | undefined
let lastTimestamp = 0
let sequence = 0

export function generateId(): string {
  workerId ??= crypto.getRandomValues(new Uint16Array(1))[0] % 1024
  const now = Date.now()
  if (now === lastTimestamp) {
    sequence = (sequence + 1) % 4096
  } else {
    lastTimestamp = now
    sequence = 0
  }

  return ((BigInt(now - SNOWFLAKE_EPOCH_MS) << 22n) | (BigInt(workerId) << 12n) | BigInt(sequence)).toString()
}

const snowflakeId = text('id')
  .primaryKey()
  .$defaultFn(() => generateId())

// ISO-8601 text keeps the existing `new Date().toISOString()` call sites working
// and sorts correctly as text in SQLite.
const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

// Better Auth passes `Date` objects to the adapter regardless of provider. The
// PG schema stringifies them through `timestamp({ mode: 'string' })`; SQLite's
// plain `text()` would hand the Date to D1, which only binds primitives.
const isoDateText = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text'
  },
  toDriver(value) {
    const candidate: unknown = value
    return candidate instanceof Date ? candidate.toISOString() : (candidate as string)
  },
})

function createdAt(name = 'created_at') {
  return isoDateText(name).notNull().default(nowIso)
}

function updatedAt(name = 'updated_at') {
  return isoDateText(name).notNull().default(nowIso)
}

// The Worker build must not pull the whole builder package just for these
// shared types; the shapes only need to match at the column boundary.
export type ManifestVersion = string
// eslint-disable-next-line ts/no-explicit-any
export type PhotoManifestItem = any

export const CURRENT_PHOTO_MANIFEST_VERSION: ManifestVersion = CURRENT_MANIFEST_VERSION
export const DATABASE_ONLY_PROVIDER = 'database-only'

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

export const authUsers = sqliteTable(
  'auth_user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    role: text('role').$type<PlatformRole>().notNull().default('user'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' }).notNull().default(false),
    username: text('username'),
    displayUsername: text('display_username'),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: isoDateText('ban_expires_at'),
    deletionRequestedAt: isoDateText('deletion_requested_at'),
    lastSignedInAt: isoDateText('last_signed_in_at'),
    lastActiveAt: isoDateText('last_active_at'),
  },
  (t) => [uniqueIndex('uq_auth_user_email_normalized').on(sql`lower(trim(${t.email}))`)],
)

export const authSessions = sqliteTable('auth_session', {
  id: text('id').primaryKey(),
  expiresAt: isoDateText('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  impersonatedBy: text('impersonated_by'),
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
    accessTokenExpiresAt: isoDateText('access_token_expires_at'),
    refreshTokenExpiresAt: isoDateText('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_auth_account_provider').on(t.providerId, t.accountId),
    index('idx_auth_account_user').on(t.userId),
  ],
)

export const authVerifications = sqliteTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: isoDateText('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const daemonAuthCodes = sqliteTable(
  'daemon_auth_code',
  {
    id: snowflakeId,
    codeHash: text('code_hash').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    state: text('state'),
    expiresAt: isoDateText('expires_at').notNull(),
    consumedAt: isoDateText('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('uq_daemon_auth_code_hash').on(t.codeHash), index('idx_daemon_auth_code_user').on(t.userId)],
)

export const daemonTokens = sqliteTable(
  'daemon_token',
  {
    id: snowflakeId,
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    createdAt: createdAt(),
    lastUsedAt: isoDateText('last_used_at'),
    expiresAt: isoDateText('expires_at'),
    revokedAt: isoDateText('revoked_at'),
  },
  (t) => [uniqueIndex('uq_daemon_token_hash').on(t.tokenHash), index('idx_daemon_token_user').on(t.userId)],
)

export const settings = sqliteTable(
  'settings',
  {
    id: snowflakeId,
    key: text('key').notNull(),
    value: text('value').notNull(),
    isSensitive: integer('is_sensitive', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('uq_settings_key').on(t.key)],
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
  (t) => [uniqueIndex('uq_system_setting_key').on(t.key)],
)

export const reactions = sqliteTable(
  'reactions',
  {
    id: snowflakeId,
    createdAt: createdAt(),
    refKey: text('ref_key').notNull(),
    reaction: text('reaction').notNull(),
  },
  (t) => [index('idx_reactions_ref_key').on(t.refKey)],
)

export const comments = sqliteTable(
  'comment',
  {
    id: snowflakeId,
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
  (t) => [
    foreignKey({
      name: 'fk_comment_parent',
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete('set null'),
    index('idx_comment_photo').on(t.photoId),
    index('idx_comment_parent').on(t.parentId),
    index('idx_comment_user').on(t.userId),
  ],
)

export const commentReactions = sqliteTable(
  'comment_reaction',
  {
    id: snowflakeId,
    commentId: text('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    reaction: text('reaction').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_comment_reaction_user').on(t.commentId, t.userId, t.reaction),
    index('idx_comment_reaction_comment').on(t.commentId),
  ],
)

export const photoAssets = sqliteTable(
  'photo_asset',
  {
    id: snowflakeId,
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
  (t) => [
    uniqueIndex('uq_photo_asset_storage_key').on(t.storageKey),
    uniqueIndex('uq_photo_asset_photo_id').on(t.photoId),
    index('idx_photo_asset_synced').on(t.syncedAt),
  ],
)

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

export const photoAiIndex = sqliteTable(
  'photo_ai_index',
  {
    id: snowflakeId,
    assetId: text('asset_id')
      .notNull()
      .references(() => photoAssets.id, { onDelete: 'cascade' }),
    photoId: text('photo_id').notNull(),
    status: text('status')
      .$type<'pending' | 'processing' | 'ready' | 'failed' | 'skipped'>()
      .notNull()
      .default('pending'),
    aiTags: text('ai_tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    caption: text('caption'),
    searchText: text('search_text'),
    sourceHash: text('source_hash'),
    modelVision: text('model_vision'),
    modelEmbedding: text('model_embedding'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: isoDateText('next_attempt_at'),
    lastError: text('last_error'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: isoDateText('lease_expires_at'),
    indexedAt: isoDateText('indexed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_photo_ai_asset').on(t.assetId),
    uniqueIndex('uq_photo_ai_photo').on(t.photoId),
    index('idx_photo_ai_backfill').on(t.status, t.nextAttemptAt, t.leaseExpiresAt),
  ],
)

export const manifestStates = sqliteTable('manifest_state', {
  id: text('id').primaryKey().default('default'),
  revision: integer('revision').notNull().default(0),
  updatedAt: updatedAt(),
})

export const manifestChanges = sqliteTable(
  'manifest_change',
  {
    revision: integer('revision').primaryKey(),
    operation: text('operation').$type<ManifestChangeOperation>().notNull(),
    photoId: text('photo_id').notNull(),
    payload: text('payload', { mode: 'json' }).$type<ManifestChangePayload>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('idx_manifest_change_photo').on(t.photoId)],
)

export const dbSchema = {
  authUsers,
  authSessions,
  authAccounts,
  authVerifications,
  settings,
  systemSettings,
  reactions,
  comments,
  commentReactions,
  photoAssets,
  photoAiIndex,
  manifestStates,
  manifestChanges,
}

export type SQLiteDBSchema = typeof dbSchema
export type DBSchema = SQLiteDBSchema
