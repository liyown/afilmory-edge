import { authAccounts, authSessions, authUsers, authVerifications, generateId } from '@afilmory/db'
import { env } from '@afilmory/env'
import { DrizzleProvider } from '@core/database/database.provider'
import { BizException } from '@core/errors'
import { SystemSettingService } from '@core/modules/configuration/system-setting/system-setting.service'
import type { OnModuleInit } from '@tsuki-hono/common'
import { createLogger, HttpContext } from '@tsuki-hono/common'
import type { BetterAuthOptions } from 'better-auth'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { admin } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { injectable } from 'tsyringe'

import { AppleClientSecretService } from './apple-client-secret.service'
import type { AuthModuleOptions, SocialProviderOptions, SocialProvidersConfig } from './auth.config'
import { AuthConfig } from './auth.config'
import { AUTH_ACCOUNT_POLICY } from './auth-account.policy'
import { AUTH_ADMIN_PLUGIN_OPTIONS } from './auth-admin.policy'
import { AUTH_COOKIE_POLICY } from './auth-cookie.policy'

type BetterAuthBaseInstance = ReturnType<typeof betterAuth>

export type BetterAuthInstance = BetterAuthBaseInstance

const logger = createLogger('Auth')
const TRAILING_SLASHES_PATTERN = /\/+$/

@injectable()
export class AuthProvider implements OnModuleInit {
  constructor(
    private readonly config: AuthConfig,
    private readonly drizzleProvider: DrizzleProvider,
    private readonly systemSettings: SystemSettingService,
    private readonly appleClientSecrets: AppleClientSecretService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.config.getOptions()
  }

  private async buildBetterAuthProvidersForHost(
    providers: SocialProvidersConfig,
    oauthGatewayUrl: string | null,
    apple: AuthModuleOptions['apple'],
  ): Promise<Record<string, unknown>> {
    const entries: Array<[keyof SocialProvidersConfig, SocialProviderOptions]> = Object.entries(providers).filter(
      (entry): entry is [keyof SocialProvidersConfig, SocialProviderOptions] => Boolean(entry[1]),
    )

    const result = entries.reduce<Record<string, unknown>>((acc, [key, value]) => {
      const redirectUri = this.buildRedirectUri(key, oauthGatewayUrl)
      acc[key] = {
        clientId: value.clientId,
        clientSecret: value.clientSecret,
        // Social sign-in may only attach to the pre-existing owner account.
        disableSignUp: true,
        ...(redirectUri ? { redirectURI: redirectUri } : {}),
      }
      return acc
    }, {})

    if (apple) {
      const redirectUri = this.buildRedirectUri('apple', oauthGatewayUrl)
      result.apple = {
        clientId: apple.clientId,
        clientSecret: await this.appleClientSecrets.generate(apple),
        ...(redirectUri ? { redirectURI: redirectUri } : {}),
      }
    }

    return result
  }

  private buildRedirectUri(
    provider: keyof SocialProvidersConfig | 'apple',
    oauthGatewayUrl: string | null,
  ): string | null {
    const basePath = `/api/auth/callback/${provider}`

    if (oauthGatewayUrl) {
      return this.buildGatewayRedirectUri(oauthGatewayUrl, basePath)
    }
    logger.error(
      ['[AuthProvider] OAuth 网关地址未配置，无法为第三方登录生成回调 URL。', `provider=${String(provider)}`].join(' '),
    )
    return null
  }

  private buildGatewayRedirectUri(gatewayBaseUrl: string, basePath: string): string {
    const normalizedBase = gatewayBaseUrl.replace(TRAILING_SLASHES_PATTERN, '')
    return `${normalizedBase}${basePath}`
  }

  private resolveRequestOrigin(): string | null {
    try {
      const hono = HttpContext.getValue('hono') as Context | undefined
      return hono ? new URL(hono.req.url).origin : null
    } catch {
      return null
    }
  }

  private buildTrustedOrigins(): string[] {
    if (env.NODE_ENV !== 'production') {
      return ['http://localhost:*', 'https://localhost:*']
    }

    // The personal deployment is reachable through a workers.dev host or a
    // custom domain, so trust the request origin rather than a configured
    // wildcard.
    const requestOrigin = this.resolveRequestOrigin()
    return requestOrigin ? [requestOrigin] : []
  }

  private async createAuth(options: AuthModuleOptions): Promise<BetterAuthInstance> {
    const db = this.drizzleProvider.getDb()
    const socialProviders = await this.buildBetterAuthProvidersForHost(
      options.socialProviders,
      options.oauthGatewayUrl,
      options.apple,
    )

    const auth = betterAuth({
      database: drizzleAdapter(db, {
        provider: 'sqlite',
        schema: {
          user: authUsers,
          session: authSessions,
          account: authAccounts,
          verification: authVerifications,
        },
      }),
      // Better Auth refuses to start without an explicit secret in production.
      secret: env.BETTER_AUTH_SECRET ?? env.CONFIG_ENCRYPTION_KEY,
      socialProviders: socialProviders as BetterAuthOptions['socialProviders'],
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
        // The administrator is created explicitly with `bootstrap:admin`.
        disableSignUp: true,
      },
      trustedOrigins: this.buildTrustedOrigins(),
      session: {
        freshAge: 0,
      },
      account: AUTH_ACCOUNT_POLICY,

      user: {
        additionalFields: {
          role: { type: 'string', input: false },
          deletionRequestedAt: { type: 'date', input: false, required: false },
        },
      },
      databaseHooks: {
        user: {
          create: {
            before: async (user) => {
              return {
                data: {
                  ...user,
                  email: user.email.trim().toLowerCase(),
                  role: user.role ?? 'user',
                },
              }
            },
          },
        },
        session: {
          create: {
            before: async (session) => {
              const [user] = await db
                .select({ deletionRequestedAt: authUsers.deletionRequestedAt })
                .from(authUsers)
                .where(eq(authUsers.id, session.userId))
                .limit(1)
              if (user?.deletionRequestedAt) {
                throw new APIError('FORBIDDEN', { message: 'This account is being deleted.' })
              }
              return { data: session }
            },
            after: async (session) => {
              const occurredAt = new Date().toISOString()
              await db
                .update(authUsers)
                .set({ lastSignedInAt: occurredAt, lastActiveAt: occurredAt })
                .where(eq(authUsers.id, session.userId))
            },
          },
        },
      },
      advanced: {
        ...AUTH_COOKIE_POLICY,
        database: {
          generateId: () => generateId(),
        },
      },
      plugins: [admin(AUTH_ADMIN_PLUGIN_OPTIONS)],
      hooks: {
        before: createAuthMiddleware(async (ctx) => {
          if (ctx.path !== '/sign-up/email') {
            return
          }

          try {
            await this.systemSettings.ensureRegistrationAllowed()
          } catch (error) {
            if (error instanceof BizException) {
              throw new APIError('FORBIDDEN', {
                message: error.message,
              })
            }

            throw error
          }
        }),
      },
    })

    return auth as unknown as BetterAuthInstance
  }

  async getAuth(): Promise<BetterAuthInstance> {
    const options = await this.config.getOptions()
    return await this.createAuth(options)
  }

  async getEnabledProviderIds(): Promise<string[]> {
    const options = await this.config.getOptions()
    return [...Object.keys(options.socialProviders), ...(options.apple ? ['apple'] : [])]
  }

  async getWebProviderIds(): Promise<string[]> {
    return await this.getEnabledProviderIds()
  }

  async isProviderEnabled(provider: string): Promise<boolean> {
    return (await this.getEnabledProviderIds()).includes(provider)
  }

  async handler(context: Context): Promise<Response> {
    const requestPath = typeof context.req.path === 'string' ? context.req.path : new URL(context.req.url).pathname
    if (requestPath.startsWith('/api/auth/error')) {
      const error = context.req.query('error')
      const errorDescription = context.req.query('error_description')
      const provider = context.req.query('provider')
      const debugParts = [
        '[AuthProvider] OAuth callback error encountered.',
        error ? `error=${error}` : null,
        errorDescription ? `description=${errorDescription}` : null,
        provider ? `provider=${provider}` : null,
        `url=${context.req.url}`,
      ].filter(Boolean)
      logger.error(debugParts.join(' '))
    }
    const auth = await this.getAuth()
    return auth.handler(context.req.raw)
  }

  async handleRequest(request: Request): Promise<Response> {
    const auth = await this.getAuth()
    return auth.handler(request)
  }
}

export type AuthInstance = BetterAuthInstance
export type AuthSession = NonNullable<Awaited<ReturnType<BetterAuthBaseInstance['api']['getSession']>>>
