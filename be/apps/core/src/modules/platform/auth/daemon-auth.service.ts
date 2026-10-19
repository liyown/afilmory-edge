import { authUsers, daemonAuthCodes, daemonTokens } from '@afilmory/db'
import type { HttpContextAuth } from '@core/context/http-context.values'
import { DbAccessor } from '@core/database/database.provider'
import { BizException, ErrorCode } from '@core/errors'
import { and, eq, isNull } from 'drizzle-orm'
import { injectable } from 'tsyringe'

const AUTH_CODE_TTL_MS = 5 * 60 * 1000
const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000
const LAST_USED_WRITE_INTERVAL_MS = 60 * 60 * 1000
const TOKEN_PREFIX = 'afi_'
const AUTH_CODE_PREFIX = 'afi_code_'
const PKCE_PATTERN = /^[\w-]{43}$/

export interface AuthorizeInput {
  name?: string
  redirectUri?: string
  codeChallenge?: string
  state?: string
}

export interface AuthorizeResult {
  code: string
  state: string | null
  expiresAt: string
}

export interface ExchangeTokenInput {
  code?: string
  codeVerifier?: string
}

export interface ExchangeTokenResult {
  token: string
  tokenId: string
  prefix: string
  name: string
  expiresAt: string
}

export interface DaemonTokenSummary {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function randomSecret(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function isLoopbackRedirect(uri: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return false
  }

  if (parsed.protocol !== 'http:' || parsed.pathname !== '/callback' || !parsed.port) {
    return false
  }

  return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]'
}

function toIso(value: string | null | undefined): string | null {
  return value ?? null
}

@injectable()
export class DaemonAuthService {
  constructor(private readonly dbAccessor: DbAccessor) {}

  async authorize(userId: string, input: AuthorizeInput): Promise<AuthorizeResult> {
    const redirectUri = input.redirectUri?.trim()
    const codeChallenge = input.codeChallenge?.trim()
    const name = input.name?.trim() || 'Afilmory Sync'

    if (!redirectUri || !isLoopbackRedirect(redirectUri)) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, {
        message: 'redirectUri must be a loopback callback URL',
      })
    }
    if (!codeChallenge || !PKCE_PATTERN.test(codeChallenge)) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'Invalid PKCE challenge' })
    }
    if (name.length > 120) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'Name is too long' })
    }

    const code = `${AUTH_CODE_PREFIX}${randomSecret()}`
    const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString()
    const state = input.state?.trim() || null
    if (state && state.length > 512) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'State is too long' })
    }

    await this.dbAccessor
      .get()
      .insert(daemonAuthCodes)
      .values({
        codeHash: await sha256Hex(code),
        userId,
        name,
        redirectUri,
        codeChallenge,
        state,
        expiresAt,
      })

    return { code, state, expiresAt }
  }

  async exchange(input: ExchangeTokenInput): Promise<ExchangeTokenResult> {
    const code = input.code?.trim()
    const codeVerifier = input.codeVerifier?.trim()
    if (!code?.startsWith(AUTH_CODE_PREFIX) || !codeVerifier) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: 'Invalid authorization code' })
    }

    const db = this.dbAccessor.get()
    const [record] = await db
      .select()
      .from(daemonAuthCodes)
      .where(eq(daemonAuthCodes.codeHash, await sha256Hex(code)))
      .limit(1)

    if (!record || record.consumedAt || Date.parse(record.expiresAt) <= Date.now()) {
      throw new BizException(ErrorCode.AUTH_UNAUTHORIZED, { message: 'Authorization code is invalid or expired' })
    }

    if ((await pkceChallenge(codeVerifier)) !== record.codeChallenge) {
      throw new BizException(ErrorCode.AUTH_UNAUTHORIZED, { message: 'PKCE verification failed' })
    }

    const consumed = await db
      .update(daemonAuthCodes)
      .set({ consumedAt: new Date().toISOString() })
      .where(and(eq(daemonAuthCodes.id, record.id), isNull(daemonAuthCodes.consumedAt)))
      .returning({ id: daemonAuthCodes.id })

    if (consumed.length === 0) {
      throw new BizException(ErrorCode.AUTH_UNAUTHORIZED, { message: 'Authorization code was already used' })
    }

    return await this.createToken(record.userId, record.name)
  }

  async listTokens(userId: string): Promise<DaemonTokenSummary[]> {
    const rows = await this.dbAccessor
      .get()
      .select({
        id: daemonTokens.id,
        name: daemonTokens.name,
        prefix: daemonTokens.tokenPrefix,
        createdAt: daemonTokens.createdAt,
        lastUsedAt: daemonTokens.lastUsedAt,
        expiresAt: daemonTokens.expiresAt,
        revokedAt: daemonTokens.revokedAt,
      })
      .from(daemonTokens)
      .where(eq(daemonTokens.userId, userId))
      .orderBy(daemonTokens.createdAt)

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      createdAt: row.createdAt,
      lastUsedAt: toIso(row.lastUsedAt),
      expiresAt: toIso(row.expiresAt),
      revokedAt: toIso(row.revokedAt),
    }))
  }

  async revokeToken(userId: string, id: string): Promise<{ ok: true }> {
    const updated = await this.dbAccessor
      .get()
      .update(daemonTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(daemonTokens.id, id), eq(daemonTokens.userId, userId), isNull(daemonTokens.revokedAt)))
      .returning({ id: daemonTokens.id })

    if (updated.length === 0) {
      throw new BizException(ErrorCode.COMMON_NOT_FOUND, { message: 'Token not found' })
    }
    return { ok: true }
  }

  async resolveBearer(raw: string): Promise<HttpContextAuth | null> {
    if (!raw.startsWith(TOKEN_PREFIX) || raw.startsWith(AUTH_CODE_PREFIX)) {
      return null
    }

    const db = this.dbAccessor.get()
    const [token] = await db
      .select()
      .from(daemonTokens)
      .where(eq(daemonTokens.tokenHash, await sha256Hex(raw)))
      .limit(1)

    if (!token || token.revokedAt || (token.expiresAt && Date.parse(token.expiresAt) <= Date.now())) {
      return null
    }

    const [user] = await db.select().from(authUsers).where(eq(authUsers.id, token.userId)).limit(1)
    if (!user || user.banned || user.deletionRequestedAt) {
      return null
    }

    if (!token.lastUsedAt || Date.now() - Date.parse(token.lastUsedAt) >= LAST_USED_WRITE_INTERVAL_MS) {
      await db.update(daemonTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(daemonTokens.id, token.id))
    }

    const now = new Date()
    return {
      user: {
        ...user,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt),
      },
      session: {
        id: `daemon-${token.id}`,
        token: '',
        userId: user.id,
        expiresAt: token.expiresAt ? new Date(token.expiresAt) : new Date(now.getTime() + 24 * 60 * 60 * 1000),
        createdAt: new Date(token.createdAt),
        updatedAt: now,
        ipAddress: null,
        userAgent: 'afilmory-sync',
        impersonatedBy: null,
      },
    } as unknown as HttpContextAuth
  }

  private async createToken(userId: string, name: string): Promise<ExchangeTokenResult> {
    const token = `${TOKEN_PREFIX}${randomSecret()}`
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()
    const [record] = await this.dbAccessor
      .get()
      .insert(daemonTokens)
      .values({
        userId,
        name,
        tokenHash: await sha256Hex(token),
        tokenPrefix: token.slice(0, 12),
        expiresAt,
      })
      .returning({ id: daemonTokens.id })

    return {
      token,
      tokenId: record.id,
      prefix: token.slice(0, 12),
      name,
      expiresAt,
    }
  }
}
