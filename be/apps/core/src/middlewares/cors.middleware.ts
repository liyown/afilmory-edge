import type { HttpMiddleware } from '@tsuki-hono/common'
import { Middleware } from '@tsuki-hono/common'
import type { Context, Next } from 'hono'
import { cors } from 'hono/cors'
import { injectable } from 'tsyringe'

@Middleware({ priority: -2 })
@injectable()
export class CorsMiddleware implements HttpMiddleware {
  private readonly corsMiddleware = cors({
    // The personal deployment is same-origin. Reflecting arbitrary origins
    // while allowing credentials adds attack surface with no product benefit.
    origin: (origin, context) => {
      const requestOrigin = new URL(context.req.url).origin
      return origin === requestOrigin ? origin : null
    },
    credentials: true,
    allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Lang'],
  })

  async use(context: Context, next: Next) {
    return await this.corsMiddleware(context, next)
  }
}
