import { decodeGatewayState, encodeGatewayState } from '@afilmory/be-utils'
import { authUsers } from '@afilmory/db'
import { env } from '@afilmory/env'
import { DbAccessor } from '@core/database/database.provider'
import { BizException, ErrorCode } from '@core/errors'
import { PlatformRoles, RequireAuth } from '@core/guards/roles.decorator'
import { BypassResponseTransform } from '@core/interceptors/response-transform.decorator'
import { SystemSettingService } from '@core/modules/configuration/system-setting/system-setting.service'
import { Body, ContextParam, Controller, createLogger, Get, HttpContext, Param, Post } from '@tsuki-hono/common'
import { freshSessionMiddleware } from 'better-auth/api'
import { desc, eq } from 'drizzle-orm'
import type { Context } from 'hono'

import { AuthProvider } from './auth.provider'

const logger = createLogger('AuthController')

const SOCIAL_PROVIDER_METADATA: Record<string, { name: string; icon: string }> = {
  google: {
    name: 'Google',
    icon: 'i-logos-google-icon',
  },
  github: {
    name: 'GitHub',
    icon: 'i-logos-github-icon',
  },
  apple: {
    name: 'Apple',
    icon: 'i-simple-icons-apple',
  },
}

const PROVIDER_ID_SEPARATOR_PATTERN = /[-_]/g
const PROVIDER_ID_WORD_START_PATTERN = /\b\w/g

function resolveSocialProviderMetadata(id: string): { name: string; icon: string } {
  const metadata = SOCIAL_PROVIDER_METADATA[id]
  if (metadata) {
    return metadata
  }
  const formattedId = id
    .replaceAll(PROVIDER_ID_SEPARATOR_PATTERN, ' ')
    .replaceAll(PROVIDER_ID_WORD_START_PATTERN, (match) => match.toUpperCase())
  return {
    name: formattedId.trim() || id,
    icon: 'i-mingcute-earth-2-line',
  }
}

function buildProviderResponse(providerIds: readonly string[]) {
  return providerIds.map((id) => {
    const metadata = resolveSocialProviderMetadata(id)
    return {
      id,
      name: metadata.name,
      icon: metadata.icon,
      callbackPath: `/api/auth/callback/${id}`,
    }
  })
}

type SocialSignInRequest = {
  provider: string
  requestSignUp?: boolean
  callbackURL?: string
  errorCallbackURL?: string
  newUserCallbackURL?: string
  disableRedirect?: boolean
  additionalData?: Record<string, unknown>
}

type LinkSocialAccountRequest = {
  provider?: string
  callbackURL?: string
  errorCallbackURL?: string
  disableRedirect?: boolean
  additionalData?: Record<string, unknown>
}

type UnlinkSocialAccountRequest = {
  providerId?: string
  accountId?: string
}

type SocialAccountRecord = {
  id: string
  providerId: string
  accountId: string
  createdAt: string
  updatedAt: string
  scopes: string[]
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthProvider,
    private readonly dbAccessor: DbAccessor,
    private readonly systemSettings: SystemSettingService,
  ) {}

  private readonly gatewayStateSecret = env.AUTH_GATEWAY_STATE_SECRET ?? env.CONFIG_ENCRYPTION_KEY

  @Get('/session')
  async getSession(@ContextParam() _context: Context) {
    const authContext = HttpContext.getValue('auth')

    if (!authContext?.user || !authContext.session) {
      return null
    }

    return {
      user: authContext.user,
      session: authContext.session,
    }
  }

  @Post('/sign-out')
  async signOut(@ContextParam() context: Context) {
    const auth = await this.auth.getAuth()
    const { headers } = context.req.raw
    return await auth.api.signOut({ headers, asResponse: true })
  }

  @Get('/social/providers')
  @BypassResponseTransform()
  async getSocialProviders() {
    return { providers: buildProviderResponse(await this.auth.getWebProviderIds()) }
  }

  @Get('/social/accounts')
  @RequireAuth()
  async getSocialAccounts(@ContextParam() context: Context) {
    const auth = await this.auth.getAuth()
    const { headers } = context.req.raw
    const accounts = await auth.api.listUserAccounts({ headers })
    const enabledProviders = new Set(await this.auth.getEnabledProviderIds())
    return {
      accounts: accounts
        .filter((account) => account.providerId !== 'credential' && enabledProviders.has(account.providerId))
        .map((account) => this.serializeSocialAccount(account)),
    }
  }

  @Post('/social/link')
  @RequireAuth()
  async linkSocialAccount(@ContextParam() context: Context, @Body() body: LinkSocialAccountRequest) {
    return await this.handleLinkSocialAccount(context, body)
  }

  // Compatibility for Better Auth client default path
  @Post('/link-social')
  @RequireAuth()
  async linkSocialAccountCompat(@ContextParam() context: Context, @Body() body: LinkSocialAccountRequest) {
    return await this.handleLinkSocialAccount(context, body)
  }

  private async handleLinkSocialAccount(context: Context, body: LinkSocialAccountRequest) {
    const provider = body?.provider?.trim()
    if (!provider) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: '缺少 OAuth Provider 参数' })
    }

    if (!(await this.auth.isProviderEnabled(provider))) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: '当前未启用该 OAuth Provider' })
    }

    const { headers } = context.req.raw
    const callbackURL = this.normalizeCallbackUrl(body?.callbackURL)
    const errorCallbackURL = this.normalizeCallbackUrl(body?.errorCallbackURL)

    const auth = await this.auth.getAuth()

    const response = await auth.api.linkSocialAccount({
      headers,
      body: {
        provider,
        requestSignUp: false,
        disableRedirect: body?.disableRedirect ?? true,
        ...(callbackURL ? { callbackURL } : {}),
        ...(errorCallbackURL ? { errorCallbackURL } : {}),
        additionalData: body?.additionalData,
      },
      asResponse: true,
    })

    return await this.rewriteOAuthState(response)
  }

  @Post('/social/unlink')
  @RequireAuth()
  async unlinkSocialAccount(@ContextParam() context: Context, @Body() body: UnlinkSocialAccountRequest) {
    const providerId = body?.providerId?.trim()
    if (!providerId) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: '缺少 OAuth Provider 参数' })
    }

    const { headers } = context.req.raw
    const auth = await this.auth.getAuth()
    const enabledProviders = new Set(await this.auth.getEnabledProviderIds())
    const allAccounts = await auth.api.listUserAccounts({ headers })
    const linkedProviderAccounts = allAccounts.filter(
      (account) => account.providerId !== 'credential' && enabledProviders.has(account.providerId),
    )
    const hasTargetAccount = linkedProviderAccounts.some((account) => account.providerId === providerId)
    if (hasTargetAccount && linkedProviderAccounts.length <= 1) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: '至少需要保留一个已绑定的 OAuth Provider' })
    }

    const requestedAccountId = body?.accountId?.trim()
    const targetAccount = linkedProviderAccounts.find((account) => {
      if (account.providerId !== providerId) {
        return false
      }
      if (!requestedAccountId) {
        return true
      }
      return account.accountId === requestedAccountId || account.id === requestedAccountId
    })
    if (!targetAccount) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: '未找到要解绑的 OAuth 账号' })
    }

    const result = await auth.api.unlinkAccount({
      headers,
      body: {
        accountId: targetAccount.id,
      },
      use: [freshSessionMiddleware],
      asResponse: true,
    })

    return result
  }

  @Get('/permissions/dashboard')
  @PlatformRoles('superadmin', 'admin')
  checkDashboardPermission() {
    return { allowed: true }
  }

  @Get('/permissions/superadmin')
  @PlatformRoles('superadmin')
  checkSuperAdminPermission() {
    return { allowed: true }
  }

  @Get('/users')
  @PlatformRoles('superadmin')
  async listUsers() {
    const db = this.dbAccessor.get()
    const users = await db
      .select({
        id: authUsers.id,
        name: authUsers.name,
        email: authUsers.email,
        image: authUsers.image,
        role: authUsers.role,
        createdAt: authUsers.createdAt,
        lastSignedInAt: authUsers.lastSignedInAt,
        banned: authUsers.banned,
      })
      .from(authUsers)
      .orderBy(desc(authUsers.createdAt))

    return { users }
  }

  @Post('/users/:id/role')
  @PlatformRoles('superadmin')
  async updateUserRole(@Param('id') id: string, @Body() body: { role?: string }) {
    const { role } = body
    if (role !== 'user' && role !== 'admin') {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: '角色只能是 user 或 admin' })
    }

    const db = this.dbAccessor.get()
    const [target] = await db
      .select({ id: authUsers.id, role: authUsers.role })
      .from(authUsers)
      .where(eq(authUsers.id, id))
      .limit(1)

    if (!target) {
      throw new BizException(ErrorCode.COMMON_NOT_FOUND, { message: '用户不存在' })
    }
    if (target.role === 'superadmin') {
      throw new BizException(ErrorCode.AUTH_FORBIDDEN, { message: '不能修改站点所有者的角色' })
    }

    await db.update(authUsers).set({ role, updatedAt: new Date().toISOString() }).where(eq(authUsers.id, id))

    return { id, role }
  }

  @Post('/sign-in/email')
  async signInEmail(@ContextParam() context: Context, @Body() body: { email: string; password: string }) {
    const email = body.email.trim().toLowerCase()
    if (email.length === 0) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: '邮箱不能为空' })
    }
    const settings = await this.systemSettings.getSettings()
    if (!settings.localProviderEnabled) {
      const db = this.dbAccessor.get()
      const [record] = await db
        .select({ role: authUsers.role })
        .from(authUsers)
        .where(eq(authUsers.email, email))
        .limit(1)

      const isSuperAdmin = record?.role === 'superadmin'
      if (!isSuperAdmin) {
        throw new BizException(ErrorCode.AUTH_FORBIDDEN, {
          message: '邮箱密码登录已禁用，请联系管理员开启本地登录。',
        })
      }
    }

    const auth = await this.auth.getAuth()
    const { headers } = context.req.raw
    const response = await auth.api.signInEmail({
      body: {
        email,
        password: body.password,
      },
      asResponse: true,
      headers,
    })
    return response
  }

  @Post('/social')
  async signInSocial(@ContextParam() context: Context, @Body() body: SocialSignInRequest) {
    return await this.handleSocialSignIn(context, body)
  }

  // Compatibility for Better Auth client default path
  @Post('/sign-in/social')
  async signInSocialCompat(@ContextParam() context: Context, @Body() body: SocialSignInRequest) {
    return await this.handleSocialSignIn(context, body)
  }

  private async handleSocialSignIn(context: Context, body: SocialSignInRequest) {
    const provider = body?.provider?.trim()
    if (!provider) {
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: '缺少 OAuth Provider 参数' })
    }

    const { headers } = context.req.raw

    const shouldAllowSignUp = body.requestSignUp ?? true

    const auth = await this.auth.getAuth()
    const response = await auth.api.signInSocial({
      body: {
        ...body,
        provider,
        requestSignUp: shouldAllowSignUp,
        additionalData: body.additionalData,
      },
      headers,
      asResponse: true,
    })

    return await this.rewriteOAuthState(response)
  }

  @Get('/callback/*')
  async callback(@ContextParam() context: Context) {
    const reqUrl = new URL(context.req.url)

    let didRewriteState = false
    const wrappedState = reqUrl.searchParams.get('state')
    if (this.gatewayStateSecret && wrappedState) {
      const decoded = decodeGatewayState(wrappedState, { secret: this.gatewayStateSecret })
      if (decoded?.innerState) {
        reqUrl.searchParams.set('gatewayState', wrappedState)
        reqUrl.searchParams.set('state', decoded.innerState)
        didRewriteState = decoded.innerState !== wrappedState
      }
    }

    if (didRewriteState) {
      return context.redirect(reqUrl.toString(), 302)
    }

    return await this.auth.handler(context)
  }

  /**
   * Apple returns its web authorization response with `response_mode=form_post`.
   * The gateway state therefore has to be unwrapped in the request body instead
   * of by issuing a redirect, which would discard the one-time authorization code.
   */
  @Post('/callback/*')
  async callbackPost(@ContextParam() context: Context) {
    const request = context.req.raw
    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/x-www-form-urlencoded') || !this.gatewayStateSecret) {
      return await this.auth.handler(context)
    }

    const formData = await request.clone().formData()
    const wrappedState = formData.get('state')
    if (typeof wrappedState !== 'string') {
      return await this.auth.handler(context)
    }
    const decoded = decodeGatewayState(wrappedState, { secret: this.gatewayStateSecret })
    if (!decoded?.innerState) {
      return await this.auth.handler(context)
    }

    const body = new URLSearchParams()
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') {
        body.append(key, key === 'state' ? decoded.innerState : value)
      }
    }
    body.append('gatewayState', wrappedState)

    const headers = new Headers(request.headers)
    headers.delete('content-length')
    return await this.auth.handleRequest(
      new Request(request.url, {
        body,
        headers,
        method: request.method,
      }),
    )
  }

  @BypassResponseTransform()
  @Get('/*')
  async passthroughGet(@ContextParam() context: Context) {
    return await this.auth.handler(context)
  }

  @BypassResponseTransform()
  @Post('/*')
  async passthroughPost(@ContextParam() context: Context) {
    return await this.auth.handler(context)
  }

  private normalizeCallbackUrl(url?: string | null): string | undefined {
    if (!url) {
      return undefined
    }
    const trimmed = url.trim()
    if (!trimmed) {
      return undefined
    }

    try {
      const parsed = new URL(trimmed)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: '回调地址必须使用 http 或 https 协议' })
      }
      return parsed.toString()
    } catch (error) {
      if (error instanceof BizException) {
        throw error
      }
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, { message: '回调地址格式不正确' })
    }
  }

  private serializeSocialAccount(account: {
    id: string
    providerId: string
    accountId: string
    createdAt: Date | string
    updatedAt: Date | string
    scopes?: string[]
  }): SocialAccountRecord {
    return {
      id: account.id,
      providerId: account.providerId,
      accountId: account.accountId,
      createdAt: this.toIsoString(account.createdAt),
      updatedAt: this.toIsoString(account.updatedAt),
      scopes: Array.isArray(account.scopes) ? account.scopes : [],
    }
  }

  private toIsoString(value: Date | string): string {
    if (value instanceof Date) {
      return value.toISOString()
    }
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }

  /**
   * Wraps the Better Auth `state` parameter so the OAuth gateway can forward the
   * callback without dynamic redirect URIs. Preserves cookies/headers from the
   * upstream Better Auth response.
   */
  private async rewriteOAuthState(response: Response): Promise<Response> {
    if (!this.gatewayStateSecret) {
      return response
    }

    // Better Auth's signInSocial can return a `location` header and a JSON body
    // with a `url` field on the *same* response (e.g. when the client doesn't
    // pass disableRedirect). Both carry the OAuth authorize URL independently,
    // so both need the state wrapped or the client SDK falls back to whichever
    // one didn't get rewritten.
    const headers = new Headers()
    response.headers.forEach((value, key) => {
      headers.append(key, value)
    })

    let bodyChanged = false
    let body: BodyInit | null = response.body

    const location = response.headers.get('location')
    if (location) {
      const wrappedLocation = this.wrapGatewayState(location)
      if (wrappedLocation !== location) {
        headers.set('location', wrappedLocation)
      }
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const clone = response.clone()
      let payload: unknown
      try {
        payload = await clone.json()
      } catch {
        payload = null
      }

      if (payload && typeof payload === 'object') {
        const payloadRecord = payload as Record<string, unknown>
        const url = typeof payloadRecord.url === 'string' ? payloadRecord.url : null
        if (url) {
          const wrappedUrl = this.wrapGatewayState(url)
          if (wrappedUrl !== url) {
            headers.set('content-type', 'application/json; charset=utf-8')
            body = JSON.stringify({ ...payloadRecord, url: wrappedUrl })
            bodyChanged = true
          }
        }
      }
    }

    if (!bodyChanged && headers.get('location') === location) {
      return response
    }

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  private wrapGatewayState(url: string): string {
    if (!this.gatewayStateSecret) {
      return url
    }

    try {
      const parsed = new URL(url)
      const state = parsed.searchParams.get('state')
      if (!state) {
        logger.error(`[AuthController] No state param found on OAuth redirect url=${url}, skipping gateway wrap`)
        return url
      }

      const wrapped = encodeGatewayState({
        secret: this.gatewayStateSecret,
        innerState: state,
      })
      parsed.searchParams.set('state', wrapped)
      return parsed.toString()
    } catch (error) {
      logger.error(`[AuthController] Failed to wrap OAuth gateway state for url=${url}`, error)
      return url
    }
  }
}
