# OAuth Gateway

OAuth callback router that lets every identity provider point to a single domain
(`auth.example.com`, for example) while the actual Better Auth handlers run on your deployment host.

## How It Works

1. Better Auth (running inside `be/apps/core`) wraps the OAuth `state` envelope.
2. Providers always redirect to the fixed URL `https://auth.example.com/api/auth/callback/{provider}`.
3. For query-based callbacks, the gateway unwraps `state`, restores the inner Better Auth state,
   and issues a 302 redirect to `https://<deployment-host>/api/auth/callback/{provider}`.
4. For form-post callbacks such as Sign in with Apple on the web, the gateway validates the wrapped
   `state` from the form and issues a 307 redirect so the browser preserves the authorization body.

Because the gateway only rewrites the callback target, it does **not** interact with provider APIs or
tokens.
This keeps configuration simple (a single callback URL in GitHub/Google) while sessions are
still created on the site host.

## Development

```bash
pnpm --filter @afilmory/oauth-gateway dev
```

The service starts on `http://0.0.0.0:8790` by default.

## Environment Variables

| Variable                          | Default              | Description                                                                             |
| --------------------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| `AUTH_GATEWAY_HOST`               | `0.0.0.0`            | Interface to bind.                                                                      |
| `AUTH_GATEWAY_PORT`               | `8790`               | Port to listen on.                                                                      |
| `AUTH_GATEWAY_BASE_DOMAIN`        | _none_ (required)    | Host that receives forwarded callbacks.                                                 |
| `AUTH_GATEWAY_CALLBACK_BASE_PATH` | `/api/auth/callback` | Base path that the providers call.                                                      |
| `AUTH_GATEWAY_FORCE_HTTPS`        | `true`               | Forces redirects to `https` unless the host looks like localhost.                       |
| `AUTH_GATEWAY_STATE_SECRET`       | _none_ (required)    | HMAC secret for decoding wrapped `state` values (fallbacks to `CONFIG_ENCRYPTION_KEY`). |

## Callback Contract

### Query callback

`GET /api/auth/callback/:provider`

Query parameters:

- `state` — wrapped gateway state containing the inner Better Auth state.
- All other query parameters (`code`, etc.) are forwarded verbatim.

Example redirect produced by the gateway:

```
https://auth.example.com/api/auth/callback/github?code=...&state=<wrapped>
  ⮕ 302 → https://gallery.example.com/api/auth/callback/github?code=...&state=<inner>
```

### Form-post callback

`POST /api/auth/callback/:provider`

- Requires `Content-Type: application/x-www-form-urlencoded`.
- Reads and validates the wrapped `state` from the form body.
- Returns a 307 redirect without rewriting the body.
  The browser repeats the original POST against
  Core, whose callback handler unwraps the state and completes the provider exchange.

```text
POST https://auth.example.com/api/auth/callback/apple
  ⮕ 307 → https://gallery.example.com/api/auth/callback/apple
```

This service is intentionally stateless so it can be deployed behind a simple load balancer.
