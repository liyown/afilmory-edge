import { readdirSync } from 'node:fs'
import process, { stderr, stdout } from 'node:process'

import { bootstrapPersonalAdmin } from '../src/modules/platform/setup/personal-admin'
import type { D1Target } from './lib/d1-target'
import { createHttpD1Target, openLocalTarget } from './lib/d1-target'

export type { BootstrapOptions, BootstrapResult } from '../src/modules/platform/setup/personal-admin'
export { bootstrapPersonalAdmin } from '../src/modules/platform/setup/personal-admin'

const LOCAL_D1_DIRECTORIES = [
  new URL('../../../../apps/edge/.cloudflare/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url),
  new URL('../../../../apps/edge/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url),
]

interface BootstrapCliOptions {
  accountId: string | null
  apiToken: string | null
  databaseId: string | null
  email: string | null
  help: boolean
  local: boolean
  localFile: string | null
  name: string | null
  password: string | null
}

const USAGE = `Usage: bootstrap-admin [options]

Creates the single personal administrator. Rerunning is safe: an existing user
and credential account are reused. Provide --password (or
BOOTSTRAP_ADMIN_PASSWORD) to rotate the password; when the account is created
without one, a random password is generated and printed once.

Admin:
  --email <email>          Admin email (default: $BOOTSTRAP_ADMIN_EMAIL)
  --password <password>    Admin password (default: $BOOTSTRAP_ADMIN_PASSWORD);
                           prefer the environment variable over the flag
  --name <name>            Display name (default: $BOOTSTRAP_ADMIN_NAME)

Target (local D1):
  --local                  Use the local D1 file created by \`cf dev\`
  --local-file <path>      Use a specific SQLite file; applies migrations when
                           the schema is absent

Target (remote D1):
  --account-id <id>        Cloudflare account id (default: $CLOUDFLARE_ACCOUNT_ID)
  --database-id <id>       D1 database id (default: $CLOUDFLARE_D1_DATABASE_ID)
  --api-token <token>      API token (default: $CLOUDFLARE_API_TOKEN)

Other:
  --help                   Show this message
`

function parseCliArgs(argv: readonly string[]): BootstrapCliOptions {
  const options: BootstrapCliOptions = {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? null,
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? null,
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID ?? process.env.D1_DATABASE_ID ?? null,
    email: process.env.BOOTSTRAP_ADMIN_EMAIL ?? process.env.MIGRATION_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? null,
    help: false,
    local: false,
    localFile: null,
    name: process.env.BOOTSTRAP_ADMIN_NAME ?? process.env.MIGRATION_ADMIN_NAME ?? process.env.ADMIN_NAME ?? null,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? null,
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
      case '--api-token':
        options.apiToken = readValue()
        break
      case '--database-id':
        options.databaseId = readValue()
        break
      case '--email':
        options.email = readValue()
        break
      case '--help':
        options.help = true
        break
      case '--local':
        options.local = true
        break
      case '--local-file':
        options.localFile = readValue()
        break
      case '--name':
        options.name = readValue()
        break
      case '--password':
        options.password = readValue()
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
      .map((name) => new URL(name, directory))

    if (candidates.length === 1) {
      return candidates[0].pathname
    }
    if (candidates.length > 1) {
      throw new Error(
        `Multiple D1 files found in ${directory.pathname}; pass --local-file explicitly: ${candidates
          .map((candidate) => candidate.pathname)
          .join(', ')}`,
      )
    }
  }

  throw new Error('No local D1 file found; run \`cf dev\` once or pass --local-file')
}

function requireOption(value: string | null, name: string): string {
  if (!value) {
    throw new Error(`Missing required option: ${name}`)
  }
  return value
}

export async function runBootstrapCli(argv: readonly string[]): Promise<void> {
  const options = parseCliArgs(argv)
  if (options.help) {
    stdout.write(USAGE)
    return
  }

  const email = requireOption(options.email, '--email / BOOTSTRAP_ADMIN_EMAIL')
  const target: D1Target = options.localFile
    ? openLocalTarget(options.localFile)
    : options.local
      ? openLocalTarget(resolveLocalDatabaseFile())
      : createHttpD1Target({
          accountId: requireOption(options.accountId, '--account-id / CLOUDFLARE_ACCOUNT_ID'),
          apiToken: requireOption(options.apiToken, '--api-token / CLOUDFLARE_API_TOKEN'),
          databaseId: requireOption(options.databaseId, '--database-id / CLOUDFLARE_D1_DATABASE_ID'),
        })

  const result = await bootstrapPersonalAdmin(target, {
    email,
    name: options.name ?? undefined,
    password: options.password ?? undefined,
  })

  stdout.write(
    `Administrator ${email} is ready (user=${result.seed.createdUser ? 'created' : 'existing'}, credential=${
      result.accountCreated ? 'created' : result.passwordChanged ? 'updated' : 'unchanged'
    }).\n`,
  )

  if (result.passwordGenerated && result.password !== undefined) {
    stdout.write(`Generated password: ${result.password}\n`)
    stdout.write('Store it now; rerunning without --password will not print it again.\n')
  }
}

// `vite-node` (used by the package script) does not expose the script path in
// `process.argv`, so this file runs as a CLI unless a test imports it.
if (!process.env.VITEST) {
  try {
    await runBootstrapCli(process.argv.slice(2))
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
