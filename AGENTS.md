# AGENTS.md — monarch-money-remote-mcp

Single-tenant Cloud Run service that exposes one Monarch Money account to
both Claude (via MCP) and Custom GPT (via REST + OpenAPI), backed by the
`monarchmoney` npm SDK.

## Architecture in 10 seconds

```
claude.ai web     ──Bearer <OAuth JWT/opaque>──▶ POST /mcp   ┐
Claude Desktop /  ──Bearer $WRAPPER_API_KEY ───▶ POST /mcp   │
  mcp-remote                                                  ├─▶ shared MonarchClient ──▶ Monarch GraphQL
Custom GPT        ──X-API-Key: $WRAPPER_API_KEY▶ GET  /…     ┘

OAuth AS lives in-process:  better-auth (oidcProvider plugin) at /api/auth/*
RS metadata:                /.well-known/oauth-protected-resource (RFC 9728)
```

Single dual-mode middleware (`src/auth.ts`) accepts BOTH the static
`WRAPPER_API_KEY` (via `X-API-Key` or `Authorization: Bearer`) AND OAuth-
issued bearer tokens validated by `src/auth/verifier.ts`. The static key
short-circuits; everything else delegates to MCP SDK's `requireBearerAuth`.

## Layout

| Path | Role |
|---|---|
| `src/index.ts` | Express entrypoint, mounts `/health`, `/mcp`, `/rest/*`, OAuth surface, `trust proxy=1` for Cloud Run |
| `src/auth.ts` | Dual-mode auth: static `WRAPPER_API_KEY` short-circuit, else delegates to MCP SDK's `requireBearerAuth` with the JWT verifier |
| `src/auth/better-auth.ts` | better-auth instance (JWT plugin + oidcProvider plugin); seeds the single user; defines the pre-registered trusted client |
| `src/auth/verifier.ts` | `OAuthTokenVerifier` impl. Tries JWT validation against JWKS, falls back to opaque-token introspection via the adapter. Throws `InvalidTokenError` so 401s render properly. |
| `src/auth/router.ts` | Mounts `/api/auth/*` (better-auth), `/.well-known/oauth-protected-resource` (RFC 9728), per-IP rate limits on `/sign-in/*` (10/15min) and rest of `/api/auth/*` (100/15min), Express-layer block on `/sign-up/*` |
| `src/auth/secret-manager-adapter.ts` | Custom better-auth Adapter backed by a single `oauth-state` Secret Manager secret. Mirrors `src/session-store.ts` write-through pattern with version cleanup. |
| `src/auth/oauth-clients.ts` | Loads the `oauth-clients` Secret Manager JSON blob (N trusted OAuth clients) and maps each entry into better-auth's `trustedClients` shape. Read-only at runtime; managed via `scripts/deploy.ts --new-client|--list-clients|--remove-client`. Falls back to legacy `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` env vars only during migration. |
| `src/config.ts` | Env loader (Secret Manager surfaces secrets as env on Cloud Run) |
| `src/session-store.ts` | Monarch session-token persistence to Secret Manager (template for adapter pattern) |
| `src/monarch-client.ts` | Cached `MonarchClient` singleton |
| `src/handlers.ts` | Pure functions over the shared client (the source of truth) |
| `src/rest/router.ts` | Express adapters around `handlers.ts` |
| `src/mcp/server.ts` | Streamable HTTP transport |
| `src/mcp/tools.ts` | MCP tool registrations around `handlers.ts` |
| `openapi.yaml` | OpenAPI 3.1 for Custom GPT Action |

When you add a capability, add it once in `handlers.ts`, then wire it through
both `rest/router.ts` and `mcp/tools.ts` (and `openapi.yaml` if you want GPT
to see it).

## Commands

Runs on Node 24+ with native TypeScript stripping — no build step, no `dist/`.

```bash
npm run dev        # node --watch src/index.ts
npm run typecheck  # tsc --noEmit (purely a check; no JS emitted)
npm start          # node src/index.ts
```

Local smoke test:

```bash
curl -H "X-API-Key: $WRAPPER_API_KEY" http://localhost:8080/accounts | jq
npx @modelcontextprotocol/inspector   # connect to /mcp with Authorization: Bearer
```

## Things not to "fix"

- **`createRequire` in `src/monarch-client.ts`.** `monarchmoney@1.1.3` ships
  a broken ESM dist (extensionless internal imports rejected by Node strict
  ESM). The CJS load is intentional. Revisit only after upgrading and
  confirming `import { MonarchClient } from 'monarchmoney'` works under
  `"type": "module"`.
- **Dual-mode auth — don't collapse it.** OAuth 2.1 (better-auth) and the
  static `WRAPPER_API_KEY` are BOTH valid auth paths and must stay that way:
  the OAuth path is for claude.ai's Custom Connector (which requires it); the
  static-key path is for Custom GPT Actions (`X-API-Key`) and Claude Desktop
  via `mcp-remote` (`Authorization: Bearer`). Removing either breaks a real
  surface. `WRAPPER_API_KEY` is also the password for the OAuth user (single
  source of truth), so even if you removed the static-key short-circuit, the
  secret would still need to exist. The OAuth path supports **N pre-registered
  clients** (one per third-party connector — claude, chatgpt, etc.), managed
  via the `npm run deploy:*-client` CLI commands.
- **`oidcProvider` over `@better-auth/oauth-provider` is deliberate** (see
  the comment in `src/auth/verifier.ts`). The two plugins have a
  trustedClients-vs-JWT-access-tokens tradeoff; we picked trustedClients +
  consent-bypass and made the verifier handle both opaque and JWT tokens.
  Don't "fix" the deprecation warning without rereading that comment first.
- **Read-only.** v1 deliberately exposes no write tools. Adding
  create/update/delete tools requires an explicit `confirm: true` argument
  pattern and a user conversation, not a vibe.

## Deployment

Cloud Run, single service, `--allow-unauthenticated` (the API key is the
gate; Cloud Run IAM can't help because Claude/GPT can't send Google
credentials). Full block in `README.md`.

Secrets live in Google Secret Manager:

| Secret | Purpose |
|---|---|
| `monarch-email`, `monarch-password`, `monarch-mfa` | Monarch login credentials |
| `wrapper-api-key` | Static auth token (also reused as OAuth user password) |
| `monarch-session` | Persisted Monarch session token (skips re-login on cold start) |
| `oauth-state` | Single JSON blob holding all better-auth state (users, sessions, refresh tokens, JWKS keys). Versioned, write-through cached by `secret-manager-adapter.ts`. |
| `oauth-clients` | Single JSON-array blob — one entry per pre-registered trusted OAuth client (`name`, `clientId`, `clientSecret`, `redirects`, `skipConsent`). Managed via `npm run deploy:new-client|list-clients|remove-client`. Read at boot by `src/auth/oauth-clients.ts`. |
| `auth-user-email` | Email for the seeded single user |

Mounted as env via `--set-secrets` by `scripts/deploy.ts`, EXCEPT
`oauth-clients` — the runtime reads it via the Secret Manager API directly
so `--new-client` / `--remove-client` can take effect with just a revision
bump (no redeploy).

## Known risks

- Monarch's private GraphQL changes occasionally (domain moved from
  `api.monarchmoney.com` → `api.monarch.com` historically). Pin the SDK
  version and treat unexpected GraphQL errors as a signal to bump
  `monarchmoney` and retest, not as a bug in this codebase.
- MFA is TOTP; clock drift on the host will cause auth failures. Cloud Run
  is fine, local can drift.
