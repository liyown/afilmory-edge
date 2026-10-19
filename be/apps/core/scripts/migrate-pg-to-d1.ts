import { readFileSync } from 'node:fs'
import process, { stderr, stdout } from 'node:process'
import { DatabaseSync } from 'node:sqlite'

import { generateId } from '@afilmory/db/schema.sqlite'
import { Client, types } from 'pg'

// Keep timestamps as raw strings: `pg` otherwise converts them to JS Dates in
// the process timezone, which shifts values written as UTC ISO strings.
const PG_TIMESTAMP_OID = 1114
const PG_TIMESTAMPTZ_OID = 1184
types.setTypeParser(PG_TIMESTAMP_OID, value => value)
types.setTypeParser(PG_TIMESTAMPTZ_OID, value => value)

const DEFAULT_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? null
const DEFAULT_ADMIN_EMAIL = process.env.MIGRATION_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? null
const DEFAULT_ADMIN_NAME = process.env.MIGRATION_ADMIN_NAME ?? process.env.ADMIN_NAME ?? null
const DEFAULT_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? null
const DEFAULT_DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID ?? process.env.D1_DATABASE_ID ?? null
const DEFAULT_SOURCE_URL = process.env.MIGRATION_SOURCE_DATABASE_URL ?? process.env.DATABASE_URL ?? null
const DEFAULT_TENANT_NAME = process.env.PERSONAL_TENANT_NAME ?? 'Afilmory'
const DEFAULT_TENANT_SLUG = process.env.PERSONAL_TENANT_SLUG ?? 'root'

const DEFAULT_BATCH_SIZE = 50
const MAX_BATCH_SIZE = 100
const DEFAULT_SAMPLE_SIZE = 10
const SQLITE_MIGRATION_PATH = new URL('../../../packages/db/migrations-sqlite/0000_heavy_skin.sql', import.meta.url)

export type SqlValue = null | number | string

export interface D1Statement {
  sql: string
  params: SqlValue[]
}

export interface D1Target {
  batch: (statements: readonly D1Statement[]) => Promise<void>
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlValue[],
  ) => Promise<T[]>
}

type ColumnKind = 'boolean' | 'json' | 'number' | 'text' | 'timestamp'
type ColumnSpec = readonly [name: string, kind: ColumnKind]

export interface TableSpec {
  name: string
  columns: readonly ColumnSpec[]
  primaryKey: readonly string[]
}

function text(name: string): ColumnSpec {
  return [name, 'text']
}

function bool(name: string): ColumnSpec {
  return [name, 'boolean']
}

function number(name: string): ColumnSpec {
  return [name, 'number']
}

function json(name: string): ColumnSpec {
  return [name, 'json']
}

function timestamp(name: string): ColumnSpec {
  return [name, 'timestamp']
}

// Ordering matters: D1 enforces foreign keys inside every batch, so parents
// must be written before children. `comment` is topologically sorted at runtime
// for its self reference (`parent_id`).
export const TABLE_SPECS: readonly TableSpec[] = [
  {
    name: 'tenant',
    primaryKey: ['id'],
    columns: [
      text('id'),
      text('slug'),
      text('name'),
      text('plan_id'),
      text('storage_plan_id'),
      bool('banned'),
      text('status'),
      timestamp('created_at'),
      timestamp('updated_at'),
    ],
  },
  {
    name: 'auth_user',
    primaryKey: ['id'],
    columns: [
      text('id'),
      text('name'),
      text('email'),
      bool('email_verified'),
      text('image'),
      text('creem_customer_id'),
      bool('had_trial'),
      text('role'),
      timestamp('created_at'),
      timestamp('updated_at'),
      bool('two_factor_enabled'),
      text('username'),
      text('display_username'),
      bool('banned'),
      text('ban_reason'),
      timestamp('ban_expires_at'),
      timestamp('deletion_requested_at'),
      timestamp('last_signed_in_at'),
      timestamp('last_active_at'),
      text('last_active_surface'),
    ],
  },
  {
    name: 'tenant_membership',
    primaryKey: ['id'],
    columns: [
      text('id'),
      text('tenant_id'),
      text('user_id'),
      text('role'),
      text('status'),
      timestamp('created_at'),
      timestamp('updated_at'),
    ],
  },
  {
    name: 'auth_session',
    primaryKey: ['id'],
    columns: [
      text('id'),
      timestamp('expires_at'),
      text('token'),
      timestamp('created_at'),
      timestamp('updated_at'),
      text('ip_address'),
      text('user_agent'),
      text('impersonated_by'),
      text('active_tenant_id'),
      text('user_id'),
    ],
  },
  {
    name: 'auth_account',
    primaryKey: ['id'],
    columns: [
      text('id'),
      text('account_id'),
      text('provider_id'),
      text('user_id'),
      text('access_token'),
      text('refresh_token'),
      text('id_token'),
      timestamp('access_token_expires_at'),
      timestamp('refresh_token_expires_at'),
      text('scope'),
      text('password'),
      timestamp('created_at'),
      timestamp('updated_at'),
    ],
  },
  {
    name: 'auth_verification',
    primaryKey: ['id'],
    columns: [
      text('id'),
      text('identifier'),
      text('value'),
      timestamp('expires_at'),
      timestamp('created_at'),
      timestamp('updated_at'),
    ],
  },
  {
    name: 'settings',
    primaryKey: ['id'],
    columns: [
      text('id'),
      text('tenant_id'),
      text('key'),
      text('value'),
      bool('is_sensitive'),
      timestamp('created_at'),
      timestamp('updated_at'),
    ],
  },
  {
    name: 'system_setting',
    primaryKey: ['id'],
    columns: [
      text('id'),
      text('key'),
      json('value'),
      bool('is_sensitive'),
      text('description'),
      timestamp('created_at'),
      timestamp('updated_at'),
    ],
  },
  {
    name: 'photo_asset',
    primaryKey: ['id'],
    columns: [
      text('id'),
      text('tenant_id'),
      text('photo_id'),
      text('storage_key'),
      text('storage_provider'),
      number('size'),
      text('etag'),
      timestamp('last_modified'),
      text('metadata_hash'),
      text('manifest_version'),
      json('manifest'),
      text('sync_status'),
      text('conflict_reason'),
      json('conflict_payload'),
      timestamp('synced_at'),
      timestamp('created_at'),
      timestamp('updated_at'),
    ],
  },
  {
    name: 'photo_sync_run',
    primaryKey: ['id'],
    columns: [
      text('id'),
      text('tenant_id'),
      bool('dry_run'),
      json('summary'),
      number('actions_count'),
      timestamp('started_at'),
      timestamp('completed_at'),
      timestamp('created_at'),
      timestamp('updated_at'),
    ],
  },
  {
    name: 'tenant_manifest_state',
    primaryKey: ['tenant_id'],
    columns: [text('tenant_id'), number('revision'), timestamp('updated_at')],
  },
  {
    name: 'tenant_manifest_change',
    primaryKey: ['tenant_id', 'revision'],
    columns: [
      text('tenant_id'),
      number('revision'),
      text('operation'),
      text('photo_id'),
      json('payload'),
      timestamp('created_at'),
    ],
  },
  {
    name: 'reactions',
    primaryKey: ['id'],
    columns: [text('id'), text('tenant_id'), timestamp('created_at'), text('ref_key'), text('reaction')],
  },
  {
    name: 'comment',
    primaryKey: ['id'],
    columns: [
      text('id'),
      text('tenant_id'),
      text('photo_id'),
      text('user_id'),
      text('parent_id'),
      text('content'),
      text('status'),
      text('user_agent'),
      text('client_ip'),
      timestamp('created_at'),
      timestamp('updated_at'),
      timestamp('deleted_at'),
    ],
  },
  {
    name: 'comment_reaction',
    primaryKey: ['id'],
    columns: [
      text('id'),
      text('tenant_id'),
      text('comment_id'),
      text('user_id'),
      text('reaction'),
      timestamp('created_at'),
    ],
  },
]

export type SourceTables = Record<string, Array<Record<string, unknown>>>

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

const PG_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/

function normalizeTimestamp(value: string): string {
  const trimmed = value.trim()
  if (PG_TIMESTAMP_PATTERN.test(trimmed)) {
    return `${trimmed.replace(' ', 'T')}Z`
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Invalid timestamp value: ${value}`)
  }
  return parsed.toISOString()
}

function transformValue(name: string, kind: ColumnKind, value: unknown, context: string): SqlValue {
  if (value === null || value === undefined) {
    return null
  }

  switch (kind) {
    case 'boolean': {
      if (typeof value === 'boolean') {
        return value ? 1 : 0
      }
      if (value === 0 || value === 1) {
        return value
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === '1' || normalized === 't' || normalized === 'true') {
          return 1
        }
        if (normalized === '0' || normalized === 'f' || normalized === 'false') {
          return 0
        }
      }
      throw new TypeError(`Expected a boolean for ${context}.${name}, got ${String(value)}`)
    }

    case 'json': {
      return JSON.stringify(value)
    }

    case 'number': {
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
          throw new TypeError(`Expected a finite number for ${context}.${name}, got ${String(value)}`)
        }
        return value
      }
      if (typeof value === 'bigint') {
        return Number(value)
      }
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) {
          return parsed
        }
      }
      throw new TypeError(`Expected a number for ${context}.${name}, got ${String(value)}`)
    }

    case 'text': {
      if (typeof value === 'string') {
        return value
      }
      if (typeof value === 'number' || typeof value === 'bigint') {
        return String(value)
      }
      throw new TypeError(`Expected text for ${context}.${name}, got ${typeof value}`)
    }

    case 'timestamp': {
      if (value instanceof Date) {
        return value.toISOString()
      }
      if (typeof value === 'string') {
        return normalizeTimestamp(value)
      }
      throw new TypeError(`Expected a timestamp for ${context}.${name}, got ${typeof value}`)
    }
  }
}

export function transformRow(spec: TableSpec, row: Record<string, unknown>): Record<string, SqlValue> {
  const transformed: Record<string, SqlValue> = {}
  for (const [name, kind] of spec.columns) {
    if (!Object.hasOwn(row, name)) {
      throw new Error(`Missing column "${name}" in source table "${spec.name}"`)
    }
    transformed[name] = transformValue(name, kind, row[name], spec.name)
  }
  return transformed
}

export function buildUpsertStatement(spec: TableSpec, row: Record<string, SqlValue>): D1Statement {
  const columns = spec.columns.map(([name]) => name)
  const values = columns.map(name => row[name] ?? null)
  const primaryKey = new Set(spec.primaryKey)
  const updates = columns
    .filter(name => !primaryKey.has(name))
    .map(name => `${quoteIdentifier(name)} = excluded.${quoteIdentifier(name)}`)

  const conflictAction = updates.length === 0 ? 'do nothing' : `do update set ${updates.join(', ')}`

  return {
    sql: `insert into ${quoteIdentifier(spec.name)} (${columns.map(quoteIdentifier).join(', ')}) values (${columns.map(() => '?').join(', ')}) on conflict (${spec.primaryKey.map(quoteIdentifier).join(', ')}) ${conflictAction}`,
    params: values,
  }
}

function rowKey(spec: TableSpec, row: Record<string, unknown>): string {
  return spec.primaryKey.map(name => String(row[name])).join('|')
}

function orderCommentRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const byId = new Map(rows.map(row => [String(row.id), row]))
  const ordered: Array<Record<string, unknown>> = []
  const placed = new Set<string>()
  const visiting = new Set<string>()

  const visit = (row: Record<string, unknown>): void => {
    const id = String(row.id)
    if (placed.has(id) || visiting.has(id)) {
      return
    }
    visiting.add(id)
    const parentId = row.parent_id
    if (parentId !== null && parentId !== undefined) {
      const parent = byId.get(String(parentId))
      if (parent) {
        visit(parent)
      }
    }
    visiting.delete(id)
    placed.add(id)
    ordered.push(row)
  }

  for (const row of rows) {
    visit(row)
  }
  return ordered
}

export interface MigrationOptions {
  batchSize?: number
  onProgress?: (message: string) => void
}

export interface TableMigration {
  table: string
  rows: number
  batches: number
}

export async function migrateSourceToTarget(
  source: SourceTables,
  target: D1Target,
  options: MigrationOptions = {},
): Promise<TableMigration[]> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new RangeError(`batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}`)
  }

  const migrations: TableMigration[] = []
  for (const spec of TABLE_SPECS) {
    const sourceRows = source[spec.name] ?? []
    const orderedRows = spec.name === 'comment' ? orderCommentRows(sourceRows) : sourceRows
    const statements = orderedRows.map(row => buildUpsertStatement(spec, transformRow(spec, row)))

    let batches = 0
    for (let index = 0; index < statements.length; index += batchSize) {
      await target.batch(statements.slice(index, index + batchSize))
      batches++
    }

    options.onProgress?.(`${spec.name}: ${statements.length} rows in ${batches} batch(es)`)
    migrations.push({ table: spec.name, rows: statements.length, batches })
  }

  return migrations
}

export interface CountMismatch {
  table: string
  source: number
  target: number
}

export interface SampleMismatch {
  table: string
  key: string
  column: string
  source: unknown
  target: unknown
}

export interface VerificationReport {
  ok: boolean
  countMismatches: CountMismatch[]
  sampleMismatches: SampleMismatch[]
  sampled: number
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
}

function comparableValue(kind: ColumnKind, value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  switch (kind) {
    case 'boolean': {
      return String(Number(value) === 0 ? 0 : 1)
    }
    case 'json': {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value
      return stableStringify(parsed)
    }
    case 'number': {
      return String(Number(value))
    }
    case 'text':
    case 'timestamp': {
      return String(value)
    }
  }
}

export interface VerificationOptions {
  sampleSize?: number
}

export async function verifyMigration(
  source: SourceTables,
  target: D1Target,
  options: VerificationOptions = {},
): Promise<VerificationReport> {
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE
  if (!Number.isInteger(sampleSize) || sampleSize < 1) {
    throw new RangeError('sampleSize must be a positive integer')
  }

  const countMismatches: CountMismatch[] = []
  const sampleMismatches: SampleMismatch[] = []
  let sampled = 0

  for (const spec of TABLE_SPECS) {
    const sourceRows = source[spec.name] ?? []
    const expected = new Map<string, Record<string, SqlValue>>()
    for (const row of sourceRows) {
      const transformed = transformRow(spec, row)
      expected.set(rowKey(spec, transformed), transformed)
    }

    const [countRow] = await target.query<{ count: number }>(
      `select count(*) as "count" from ${quoteIdentifier(spec.name)}`,
    )
    const targetCount = Number(countRow?.count ?? 0)
    if (targetCount !== sourceRows.length) {
      countMismatches.push({ table: spec.name, source: sourceRows.length, target: targetCount })
    }

    const orderBy = spec.primaryKey.map(quoteIdentifier).join(', ')
    const actualRows = await target.query(`select * from ${quoteIdentifier(spec.name)} order by ${orderBy} limit ?`, [
      sampleSize,
    ])

    for (const actual of actualRows) {
      sampled++
      const key = rowKey(spec, actual)
      const expectedRow = expected.get(key)
      if (!expectedRow) {
        sampleMismatches.push({
          table: spec.name,
          key,
          column: '<row>',
          source: null,
          target: actual,
        })
        continue
      }

      for (const [column, kind] of spec.columns) {
        const sourceValue = comparableValue(kind, expectedRow[column])
        const targetValue = comparableValue(kind, actual[column])
        if (sourceValue !== targetValue) {
          sampleMismatches.push({
            table: spec.name,
            key,
            column,
            source: sourceValue,
            target: targetValue,
          })
        }
      }
    }
  }

  return {
    ok: countMismatches.length === 0 && sampleMismatches.length === 0,
    countMismatches,
    sampleMismatches,
    sampled,
  }
}

export interface SeedOptions {
  adminEmail: string
  adminName?: string
  now?: string
  slug: string
  tenantName?: string
}

export interface SeedResult {
  tenantId: string
  userId: string
  createdTenant: boolean
  createdUser: boolean
  createdMembership: boolean
}

function insertStatement(table: string, values: Record<string, SqlValue>): D1Statement {
  const columns = Object.keys(values)
  return {
    sql: `insert into ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) values (${columns.map(() => '?').join(', ')})`,
    params: columns.map(column => values[column] ?? null),
  }
}

export async function seedPersonalTenant(target: D1Target, options: SeedOptions): Promise<SeedResult> {
  const email = options.adminEmail.trim()
  if (email.length === 0) {
    throw new Error('adminEmail must not be empty')
  }

  const now = options.now ?? new Date().toISOString()
  const slug = options.slug.trim()
  const tenantName = options.tenantName?.trim() || DEFAULT_TENANT_NAME
  const adminName = options.adminName?.trim() || email.split('@')[0] || 'Admin'

  const [existingTenant] = await target.query<{ id: string }>('select "id" from "tenant" where "slug" = ? limit 1', [
    slug,
  ])
  const tenantId = existingTenant?.id ?? generateId()

  const [existingUser] = await target.query<{ id: string, role: string }>(
    'select "id", "role" from "auth_user" where lower(trim("email")) = lower(trim(?)) limit 1',
    [email],
  )
  const userId = existingUser?.id ?? generateId()

  const [existingMembership] = await target.query<{ id: string, role: string, status: string }>(
    'select "id", "role", "status" from "tenant_membership" where "tenant_id" = ? and "user_id" = ? limit 1',
    [tenantId, userId],
  )

  const statements: D1Statement[] = []

  if (!existingTenant) {
    statements.push(
      insertStatement('tenant', {
        id: tenantId,
        slug,
        name: tenantName,
        plan_id: 'free',
        storage_plan_id: null,
        banned: 0,
        status: 'active',
        created_at: now,
        updated_at: now,
      }),
    )
  }

  if (!existingUser) {
    statements.push(
      insertStatement('auth_user', {
        id: userId,
        name: adminName,
        email,
        email_verified: 1,
        role: 'superadmin',
        had_trial: 0,
        two_factor_enabled: 0,
        banned: 0,
        created_at: now,
        updated_at: now,
      }),
    )
  }
  else if (existingUser.role !== 'superadmin') {
    statements.push({
      sql: 'update "auth_user" set "role" = ?, "updated_at" = ? where "id" = ?',
      params: ['superadmin', now, userId],
    })
  }

  if (!existingMembership) {
    statements.push(
      insertStatement('tenant_membership', {
        id: generateId(),
        tenant_id: tenantId,
        user_id: userId,
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      }),
    )
  }
  else if (existingMembership.role !== 'owner' || existingMembership.status !== 'active') {
    statements.push({
      sql: 'update "tenant_membership" set "role" = ?, "status" = ?, "updated_at" = ? where "id" = ?',
      params: ['owner', 'active', now, existingMembership.id],
    })
  }

  statements.push({
    sql: 'insert into "tenant_manifest_state" ("tenant_id", "revision", "updated_at") values (?, ?, ?) on conflict ("tenant_id") do nothing',
    params: [tenantId, 0, now],
  })

  await target.batch(statements)

  return {
    tenantId,
    userId,
    createdTenant: !existingTenant,
    createdUser: !existingUser,
    createdMembership: !existingMembership,
  }
}

export interface HttpD1TargetOptions {
  accountId: string
  apiToken: string
  databaseId: string
  fetchImpl?: typeof fetch
}

interface D1QueryResult {
  error?: string
  results?: Array<Record<string, unknown>>
  success: boolean
}

interface CloudflareEnvelope<T> {
  errors?: Array<{ message?: string }>
  result?: T
  success: boolean
}

export function createHttpD1Target(options: HttpD1TargetOptions): D1Target {
  const fetchImpl = options.fetchImpl ?? fetch
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/d1/database/${encodeURIComponent(options.databaseId)}/query`

  const request = async (body: unknown): Promise<D1QueryResult[]> => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${options.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const payload = (await response.json()) as CloudflareEnvelope<D1QueryResult[]>
    if (!response.ok || !payload.success) {
      const messages = payload.errors?.map(error => error.message ?? 'unknown error').join('; ')
      throw new Error(`D1 request failed (${response.status}): ${messages ?? 'unknown error'}`)
    }
    return payload.result ?? []
  }

  return {
    async batch(statements) {
      if (statements.length === 0) {
        return
      }
      const results = await request({
        batch: statements.map(statement => ({ sql: statement.sql, params: statement.params })),
      })
      for (const [index, result] of results.entries()) {
        if (!result.success) {
          throw new Error(`D1 batch statement ${index} failed: ${result.error ?? 'unknown error'}`)
        }
      }
    },

    async query(sql, params = []) {
      const [result] = await request({ sql, params })
      if (!result) {
        return []
      }
      if (!result.success) {
        throw new Error(`D1 query failed: ${result.error ?? 'unknown error'}`)
      }
      return (result.results ?? []) as never
    },
  }
}

export function createSqliteTarget(sqlite: DatabaseSync): D1Target {
  sqlite.exec('pragma foreign_keys = on')
  return {
    async batch(statements) {
      sqlite.exec('begin')
      try {
        for (const statement of statements) {
          sqlite.prepare(statement.sql).run(...statement.params)
        }
        sqlite.exec('commit')
      }
      catch (error) {
        sqlite.exec('rollback')
        throw error
      }
    },

    async query(sql, params = []) {
      return sqlite.prepare(sql).all(...params) as never
    },
  }
}

async function loadSourceTables(connectionString: string): Promise<SourceTables> {
  const client = new Client({ connectionString })
  await client.connect()

  try {
    await client.query('begin transaction isolation level repeatable read read only')
    const tables: SourceTables = {}
    for (const spec of TABLE_SPECS) {
      const result = await client.query<Record<string, unknown>>(`select * from ${quoteIdentifier(spec.name)}`)
      tables[spec.name] = result.rows
    }
    await client.query('commit')
    return tables
  }
  catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
  finally {
    await client.end()
  }
}

export interface MigrationCliOptions {
  accountId: string | null
  adminEmail: string | null
  adminName: string | null
  apiToken: string | null
  batchSize: number
  databaseId: string | null
  dryRun: boolean
  help: boolean
  localFile: string | null
  sampleSize: number
  skipVerify: boolean
  sourceUrl: string | null
  tenantName: string
  tenantSlug: string
}

const USAGE = `Usage: migrate-pg-to-d1 [options]

Migrates the personal-edition tables from PostgreSQL into D1. Every row is
written with INSERT ... ON CONFLICT DO UPDATE, so reruns are safe.

Source (PG):
  --source-url <url>       PostgreSQL connection string
                           (default: $MIGRATION_SOURCE_DATABASE_URL or $DATABASE_URL)

Target (D1 REST API):
  --account-id <id>        Cloudflare account id (default: $CLOUDFLARE_ACCOUNT_ID)
  --database-id <id>       D1 database id (default: $CLOUDFLARE_D1_DATABASE_ID)
  --api-token <token>      API token (default: $CLOUDFLARE_API_TOKEN)

Target (local SQLite, useful for dry runs):
  --local-file <path>      Write to a local SQLite file instead of D1; applies
                           migrations-sqlite/0000_*.sql when the schema is absent

Seed (used automatically when the source has no tenant rows):
  --admin-email <email>    Admin email (default: $MIGRATION_ADMIN_EMAIL)
  --admin-name <name>      Admin display name (default: $MIGRATION_ADMIN_NAME)
  --tenant-slug <slug>     Workspace slug (default: root)
  --tenant-name <name>     Workspace name (default: Afilmory)

Other:
  --batch-size <n>         Statements per D1 batch, 1-100 (default: 50)
  --sample-size <n>        Rows sampled per table during verification (default: 10)
  --dry-run                Read the source and report counts without writing
  --skip-verify            Skip the post-migration count/sample reconciliation
  --help                   Show this message
`

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return parsed
}

export function parseMigrationCliArgs(argv: readonly string[]): MigrationCliOptions {
  const options: MigrationCliOptions = {
    accountId: DEFAULT_ACCOUNT_ID,
    adminEmail: DEFAULT_ADMIN_EMAIL,
    adminName: DEFAULT_ADMIN_NAME,
    apiToken: DEFAULT_API_TOKEN,
    batchSize: DEFAULT_BATCH_SIZE,
    databaseId: DEFAULT_DATABASE_ID,
    dryRun: false,
    help: false,
    localFile: null,
    sampleSize: DEFAULT_SAMPLE_SIZE,
    skipVerify: false,
    sourceUrl: DEFAULT_SOURCE_URL,
    tenantName: DEFAULT_TENANT_NAME,
    tenantSlug: DEFAULT_TENANT_SLUG,
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }

    const separator = arg.indexOf('=')
    const flag = separator === -1 ? arg : arg.slice(0, separator)
    const inlineValue = separator === -1 ? null : arg.slice(separator + 1)

    const readValue = (): string => {
      if (inlineValue !== null) {
        return inlineValue
      }
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Missing value for ${flag}`)
      }
      index++
      return next
    }

    switch (flag) {
      case '--account-id':
        options.accountId = readValue()
        break
      case '--admin-email':
        options.adminEmail = readValue()
        break
      case '--admin-name':
        options.adminName = readValue()
        break
      case '--api-token':
        options.apiToken = readValue()
        break
      case '--batch-size':
        options.batchSize = parsePositiveInteger(readValue(), flag)
        break
      case '--database-id':
        options.databaseId = readValue()
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--help':
        options.help = true
        break
      case '--local-file':
        options.localFile = readValue()
        break
      case '--sample-size':
        options.sampleSize = parsePositiveInteger(readValue(), flag)
        break
      case '--skip-verify':
        options.skipVerify = true
        break
      case '--source-url':
        options.sourceUrl = readValue()
        break
      case '--tenant-name':
        options.tenantName = readValue()
        break
      case '--tenant-slug':
        options.tenantSlug = readValue()
        break
      default:
        throw new Error(`Unknown option: ${flag}`)
    }
  }

  if (options.batchSize > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size must not exceed ${MAX_BATCH_SIZE}`)
  }

  return options
}

function applySqliteMigrations(sqlite: DatabaseSync): void {
  const migrations = readFileSync(SQLITE_MIGRATION_PATH, 'utf8')
  sqlite.exec(migrations)
}

function openLocalTarget(path: string): D1Target {
  const sqlite = new DatabaseSync(path)
  const hasTenantTable = sqlite.prepare('select name from sqlite_master where type = \'table\' and name = \'tenant\'').get()
  if (!hasTenantTable) {
    applySqliteMigrations(sqlite)
  }
  return createSqliteTarget(sqlite)
}

function printVerification(report: VerificationReport): void {
  stdout.write(`Verification: ${report.sampled} row(s) sampled\n`)
  for (const mismatch of report.countMismatches) {
    stderr.write(`  count mismatch ${mismatch.table}: source=${mismatch.source} target=${mismatch.target}\n`)
  }
  for (const mismatch of report.sampleMismatches) {
    stderr.write(
      `  value mismatch ${mismatch.table}[${mismatch.key}].${mismatch.column}: source=${JSON.stringify(mismatch.source)} target=${JSON.stringify(mismatch.target)}\n`,
    )
  }
}

export async function runMigrationCli(argv: readonly string[]): Promise<void> {
  const options = parseMigrationCliArgs(argv)
  if (options.help) {
    stdout.write(USAGE)
    return
  }

  const source = options.sourceUrl ? await loadSourceTables(options.sourceUrl) : null
  const hasHistory = (source?.tenant.length ?? 0) > 0

  if (options.dryRun) {
    if (source) {
      for (const spec of TABLE_SPECS) {
        stdout.write(`${spec.name}: ${source[spec.name]?.length ?? 0} row(s)\n`)
      }
    }
    if (hasHistory) {
      stdout.write('Dry run: source has history, no rows were written.\n')
    }
    else {
      stdout.write(
        `Dry run: source has no tenant rows; would seed tenant "${options.tenantSlug}" (admin: ${options.adminEmail ?? '<missing --admin-email>'}).\n`,
      )
    }
    return
  }

  const target = options.localFile
    ? openLocalTarget(options.localFile)
    : createHttpD1Target({
        accountId: requireOption(options.accountId, '--account-id / CLOUDFLARE_ACCOUNT_ID'),
        apiToken: requireOption(options.apiToken, '--api-token / CLOUDFLARE_API_TOKEN'),
        databaseId: requireOption(options.databaseId, '--database-id / CLOUDFLARE_D1_DATABASE_ID'),
      })

  if (hasHistory && source) {
    const migrations = await migrateSourceToTarget(source, target, {
      batchSize: options.batchSize,
      onProgress: message => stdout.write(`  ${message}\n`),
    })
    const rows = migrations.reduce((total, migration) => total + migration.rows, 0)
    stdout.write(`Migrated ${rows} row(s) across ${migrations.length} table(s).\n`)

    if (!options.skipVerify) {
      const report = await verifyMigration(source, target, { sampleSize: options.sampleSize })
      printVerification(report)
      if (!report.ok) {
        throw new Error('Migration verification failed')
      }
    }
    return
  }

  const adminEmail = requireOption(
    options.adminEmail,
    '--admin-email / MIGRATION_ADMIN_EMAIL (required to seed a workspace)',
  )
  const seed = await seedPersonalTenant(target, {
    adminEmail,
    adminName: options.adminName ?? undefined,
    slug: options.tenantSlug,
    tenantName: options.tenantName,
  })

  stdout.write(
    `Seeded workspace "${options.tenantSlug}" (tenant=${seed.createdTenant ? 'created' : 'existing'}, admin=${seed.createdUser ? 'created' : 'existing'}, membership=${seed.createdMembership ? 'created' : 'existing'}).\n`,
  )
  stdout.write('The admin user has no password yet; use the T3.2 bootstrap flow to set credentials.\n')
}

function requireOption(value: string | null, name: string): string {
  if (!value) {
    throw new Error(`Missing required option: ${name}`)
  }
  return value
}

// `vite-node` (used by the package script) does not expose the script path in
// `process.argv`, so this file runs as a CLI unless a test imports it.
if (!process.env.VITEST) {
  try {
    await runMigrationCli(process.argv.slice(2))
  }
  catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
