// Restore the gzipped JSON document produced by the daily cron backup
// (`apps/edge/src/cron.ts`) into a local D1 SQLite file.
//
// Download the object first, e.g. `ossutil cp oss://<bucket>/backups/d1/<name>.json.gz .`
// (or copy it from `.cloudflare/state` in local dev), then run:
//
//   pnpm -C be/apps/core restore:d1-backup --file ./backup.json.gz --local

import { readdirSync, readFileSync } from 'node:fs'
import process, { stderr, stdout } from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { gunzipSync } from 'node:zlib'

import { applySqliteMigrations, quoteIdentifier } from './lib/d1-target'

const LOCAL_D1_DIRECTORIES = [
  new URL('../../../../apps/edge/.cloudflare/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url),
  new URL('../../../../apps/edge/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url),
]

interface BackupDocument {
  version: number
  exportedAt?: string
  tables: Record<string, Array<Record<string, unknown>>>
}

interface CliOptions {
  file: string | null
  local: boolean
  localFile: string | null
  dryRun: boolean
  help: boolean
}

const USAGE = `Usage: restore-d1-backup --file <backup.json.gz> [options]

Restores a backup written by the Worker's daily cron into a local D1 file.
The target database is emptied table by table before the backup is applied;
tables created after the snapshot are left untouched.

Options:
  --file <path>        Backup file (gzipped or plain JSON)
  --local              Use the local D1 file created by \`cf dev\`
  --local-file <path>  Use a specific SQLite file
  --dry-run            Validate the backup without writing
  --help               Show this message
`

function parseCliArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { file: null, local: false, localFile: null, dryRun: false, help: false }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
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
      case '--file':
        options.file = readValue()
        break
      case '--local':
        options.local = true
        break
      case '--local-file':
        options.localFile = readValue()
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--help':
        options.help = true
        break
      default:
        throw new Error(`Unknown option: ${flag}`)
    }
  }
  if (options.local && options.localFile) {
    throw new Error('Use either --local or --local-file, not both')
  }
  return options
}

function resolveLocalDatabaseFile(): string {
  for (const directory of LOCAL_D1_DIRECTORIES) {
    const candidates = readdirSync(directory)
      .filter((name) => name.endsWith('.sqlite') && !name.includes('metadata'))
      .map((name) => new URL(name, directory).pathname)
    if (candidates.length === 1) {
      return candidates[0]
    }
    if (candidates.length > 1) {
      throw new Error(`Multiple D1 files found; pass --local-file: ${candidates.join(', ')}`)
    }
  }
  throw new Error('No local D1 file found; run `cf dev` once or pass --local-file')
}

export function parseBackup(buffer: Uint8Array): BackupDocument {
  const isGzip = buffer.length > 1 && buffer[0] === 0x1F && buffer[1] === 0x8B
  const text = (isGzip ? gunzipSync(buffer) : buffer).toString('utf8')
  const document = JSON.parse(text) as Partial<BackupDocument>
  if (document.version !== 1 || typeof document.tables !== 'object' || document.tables === null) {
    throw new Error('Unsupported backup format (expected version 1 with a tables object)')
  }
  return document as BackupDocument
}

export interface RestoreSummary {
  tables: number
  rows: number
  skippedTables: string[]
}

export function restoreBackup(sqlite: DatabaseSync, document: BackupDocument): RestoreSummary {
  const existing = new Set(
    (sqlite.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  )

  const skippedTables: string[] = []
  let rows = 0
  sqlite.exec('pragma foreign_keys = off')
  sqlite.exec('begin')
  try {
    for (const [table, tableRows] of Object.entries(document.tables)) {
      if (!existing.has(table)) {
        skippedTables.push(table)
        continue
      }
      if (!Array.isArray(tableRows) || tableRows.length === 0) {
        sqlite.exec(`delete from ${quoteIdentifier(table)}`)
        continue
      }

      const columns = Object.keys(tableRows[0])
      const placeholders = columns.map(() => '?').join(', ')
      const insert = sqlite.prepare(
        `insert into ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) values (${placeholders})`,
      )
      sqlite.exec(`delete from ${quoteIdentifier(table)}`)
      for (const row of tableRows) {
        insert.run(...columns.map((column) => (row[column] ?? null) as string | number | null))
        rows++
      }
    }
    sqlite.exec('commit')
  } catch (error) {
    sqlite.exec('rollback')
    throw error
  } finally {
    sqlite.exec('pragma foreign_keys = on')
  }

  return { tables: Object.keys(document.tables).length - skippedTables.length, rows, skippedTables }
}

export function runRestoreCli(argv: readonly string[]): void {
  const options = parseCliArgs(argv)
  if (options.help) {
    stdout.write(USAGE)
    return
  }
  if (!options.file) {
    throw new Error('Missing required option: --file')
  }

  const document = parseBackup(readFileSync(options.file))
  const tableCount = Object.keys(document.tables).length
  const rowCount = Object.values(document.tables).reduce((total, rows) => total + rows.length, 0)
  stdout.write(`Backup ${document.exportedAt ?? '(unknown date)'}: ${tableCount} tables, ${rowCount} rows.\n`)

  if (options.dryRun) {
    stdout.write('Dry run: backup parsed successfully, nothing written.\n')
    return
  }

  const path = options.localFile ?? (options.local ? resolveLocalDatabaseFile() : null)
  if (!path) {
    throw new Error('Choose a restore target: --local or --local-file <path>')
  }

  const sqlite = new DatabaseSync(path)
  const hasManifestState = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name = 'manifest_state'")
    .get()
  if (!hasManifestState) {
    stdout.write('Target has no schema; applying SQLite migrations first.\n')
    applySqliteMigrations(sqlite)
  }

  const summary = restoreBackup(sqlite, document)
  const violations = sqlite.prepare('pragma foreign_key_check').all() as unknown[]
  sqlite.close()

  stdout.write(`Restored ${summary.rows} rows into ${summary.tables} tables (${path}).\n`)
  if (summary.skippedTables.length > 0) {
    stdout.write(`Skipped tables absent from the target schema: ${summary.skippedTables.join(', ')}\n`)
  }
  if (violations.length > 0) {
    throw new Error(`Restore finished with ${violations.length} foreign key violation(s)`)
  }
}

if (!process.env.VITEST) {
  try {
    runRestoreCli(process.argv.slice(2))
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
