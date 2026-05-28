# monarch-money-remote-mcp

> **Status: stopgap snapshot.** Published as a reference / starting point
> while we wait for (a) Monarch Money to ship an official API and (b) the
> v2 release of the [`monarchmoney`](https://www.npmjs.com/package/monarchmoney)
> TypeScript SDK. Expect to retire this repo once either lands.

Single-tenant Cloud Run service that exposes a Monarch Money account to both
**Claude Custom Connector** (MCP over Streamable HTTP) and **Custom GPT
Action** (REST + OpenAPI), backed by [`monarchmoney`](https://www.npmjs.com/package/monarchmoney).

One container, three auth modes that all front the same handlers:

| Client | Endpoint | Auth |
|---|---|---|
| Claude Custom Connector (new) | `POST /mcp` | **OAuth 2.1** via `/api/auth/oauth2/*` (JWT-signing AS with JWKS at `/api/auth/jwks`) |
| Claude Custom Connector (legacy) | `POST /mcp` | `Authorization: Bearer <WRAPPER_API_KEY>` (still works) |
| Custom GPT Action | `GET /accounts`, `/transactions`, … | `X-API-Key: <WRAPPER_API_KEY>` |

## Local dev

Requires Node 24+ (uses native TypeScript execution — no build step).

```bash
cp .env.example .env   # edit with your real Monarch creds + a random key
npm install
npm run dev            # node --watch src/index.ts
```

Smoke tests:

```bash
KEY=$(grep WRAPPER_API_KEY .env | cut -d= -f2)

# REST
curl -H "X-API-Key: $KEY" http://localhost:8080/health
curl -H "X-API-Key: $KEY" http://localhost:8080/accounts | jq '.[0].displayName'

# MCP (via inspector UI)
npx @modelcontextprotocol/inspector
# Connect to http://localhost:8080/mcp with header Authorization: Bearer <KEY>
```

## Google Cloud setup (first time only)

Before you can deploy, you need a GCP project with billing enabled and the
gcloud CLI authenticated locally. Everything past that is automated by
`npm run deploy:bootstrap`.

### What to do in the Cloud Console UI

These are the only steps that require clicking around in
[console.cloud.google.com](https://console.cloud.google.com):

1. **Create a project** (or pick an existing one)
   → [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate)
   - Name it anything (e.g., `monarch-money-remote-mcp`).
   - **Copy the *Project ID*** (it auto-generates with a numeric suffix,
     e.g., `monarch-money-remote-mcp-471203`). The ID — *not* the display name — is
     what goes in `.env` as `GCP_PROJECT_ID`.

2. **Link a billing account**
   → [console.cloud.google.com/billing](https://console.cloud.google.com/billing)
   - Required even though Cloud Run's free tier covers light personal use.
     New accounts get $300 of free credit and don't auto-charge after.
   - If you don't already have a billing account, the console walks you
     through creating one.

That's it for the console. Do **not** manually enable APIs, create service
accounts, or push secrets in the UI — the deploy script does all of that.

### What to do in your terminal

3. **Install the gcloud CLI** (if you don't have it)
   → [cloud.google.com/sdk/docs/install](https://cloud.google.com/sdk/docs/install)

4. **Authenticate**

   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

5. **Fill out `.env`**

   ```bash
   cp .env.example .env
   $EDITOR .env
   # Set MONARCH_EMAIL, MONARCH_PASSWORD, MONARCH_MFA_SECRET,
   # WRAPPER_API_KEY (generate: openssl rand -base64 48 | tr -d '\n'),
   # and GCP_PROJECT_ID (and GCP_REGION / GCP_SERVICE if you want non-defaults).
   ```

## Deploy to Cloud Run

```bash
npm run deploy:bootstrap   # first deploy: enables APIs, creates SA, pushes secrets, deploys
npm run deploy             # every deploy after that
```

`npm run deploy:bootstrap` runs `gcloud services enable` for
`run`, `cloudbuild`, `artifactregistry`, `secretmanager`, and `iam` — no
manual API enablement needed.

`--allow-unauthenticated` is correct: Cloud Run IAM cannot help here because
neither Claude nor Custom GPT can send Google IAM credentials. The
`WRAPPER_API_KEY` middleware is the actual gate.

## Connect Claude (OAuth 2.1)

claude.ai → Settings → Connectors → **Add custom connector**

- Name: `Monarch`
- URL: `<URL>/mcp`
- Advanced settings →
  - **Client ID** and **Client Secret**: pulled from Secret Manager (see
    below).

Claude discovers the authorization endpoint automatically via the
`/.well-known/oauth-protected-resource` document the service publishes and
walks you through sign-in + consent.

Inspect the registered OAuth clients (the `claude` entry is auto-created on
the first `npm run deploy:bootstrap`, or migrated from the legacy
`oauth-client-id`/`oauth-client-secret` secrets if you bootstrapped before
this refactor):

```bash
npm run deploy:list-clients
```

This prints `name`, `clientId`, masked secret, and redirect URIs. To retrieve
a secret in cleartext, decode the secret blob directly:

```bash
gcloud secrets versions access latest --secret=oauth-clients --project=$GCP_PROJECT_ID | jq
```

### Adding a new OAuth client

Use `npm run deploy:new-client -- <name>` (note the `--`: npm passes
everything after it through to the script). The command generates a fresh
client id + secret, appends it to the `oauth-clients` Secret Manager blob,
and bumps the Cloud Run revision so the new client is live immediately.

For Claude the redirect URIs are baked in:

```bash
npm run deploy:new-client -- claude       # registers https://claude.ai/... + https://claude.com/...
```

For ChatGPT (and any other client whose callback URL isn't a single fixed
value), pass `--redirects` explicitly. ChatGPT's connector UI generates a
per-app callback URL like `https://chatgpt.com/connector/oauth/<id>` —
copy it from the New App dialog:

```bash
npm run deploy:new-client -- chatgpt --redirects=https://chatgpt.com/connector/oauth/7QoOc0y0-TnA
npm run deploy:new-client -- my-custom-app --redirects=https://example.com/oauth/cb,https://example.com/cb2
```

Names must match `/^[a-z0-9-]+$/`. The command refuses to overwrite an
existing entry — `npm run deploy:remove-client -- <name>` first if you want
to rotate credentials.

After migrating off the legacy `oauth-client-id`/`oauth-client-secret`
secrets you can delete them manually once you've verified the connector
still works:

```bash
gcloud secrets delete oauth-client-id     --project=$GCP_PROJECT_ID
gcloud secrets delete oauth-client-secret --project=$GCP_PROJECT_ID
```

The end-user sign-in form (better-auth's email/password page) accepts:

- **Email**: the value stored in the `auth-user-email` secret
  (default `user@<service>.local`)
- **Password**: your `WRAPPER_API_KEY` (reused — one credential to manage)

### Connect Claude (legacy `Authorization: Bearer KEY`)

The original setup still works for existing Claude integrations:

- URL: `<URL>/mcp`
- Advanced settings → **Authorization Token**: paste your `WRAPPER_API_KEY`.

## Connect Custom GPT

chatgpt.com → My GPTs → Edit → **Create new action**

1. Edit `openapi.yaml`, replace the `servers[0].url` value with your Cloud Run URL.
2. Paste the contents into the GPT Action schema field.
3. Authentication → **API Key**, custom header `X-API-Key`, value is your
   wrapper API key.
4. Test the `getAccounts` and `getTransactions` operations from the GPT Builder.

## Notes

- **Read-only.** No write tools are exposed in v1. To add them, extend
  `src/handlers.ts`, then mirror in `src/rest/router.ts`, `src/mcp/tools.ts`,
  and `openapi.yaml`.
- **Session token persists across cold starts.** On first successful login
  the Monarch session token (valid ~1 year) is saved as a new version of the
  `monarch-session` GCP Secret. Subsequent cold starts load that token,
  validate it, and skip the login flow entirely — no per-IP rate-limit risk,
  scale-to-zero costs nothing. If the token ever expires the wrapper does
  exactly one full login and saves a fresh one. Implementation:
  `src/session-store.ts` + `src/monarch-client.ts`.
- **Rate-limit cooldown (Monarch upstream).** If Monarch ever 429s the
  login, the wrapper enters a 1-hour cooldown — incoming requests return
  HTTP 503 immediately without re-hitting Monarch, so a transient lockout
  doesn't escalate.
- **Auth-endpoint rate limits.** `/api/auth/sign-in/*` is limited to 10
  attempts per IP per 15 minutes; the rest of `/api/auth/*` (token refresh,
  JWKS, authorize) to 100. Returns HTTP 429 when exhausted. Cloud Run sits
  behind GFE, so the app trusts one proxy hop for accurate per-IP limiting.
- **OAuth state persists across cold starts.** All better-auth state
  (registered clients, sessions, refresh tokens, JWT signing keys) lives in
  a single `oauth-state` GCP Secret, write-through cached in memory by
  `src/auth/secret-manager-adapter.ts`. Rotating that secret invalidates
  every outstanding access/refresh token — single-user, acceptable.
- **Single seeded user.** The OAuth flow's login page accepts exactly one
  user (`AUTH_USER_EMAIL` + `WRAPPER_API_KEY` as password). Seeded
  idempotently in-process at boot. The public sign-up endpoint
  (`/api/auth/sign-up/*`) is blocked at the Express layer.
- **Rotation.** Edit `.env`, run `npm run deploy:rotate-secrets`. Then:
  Custom GPT `X-API-Key` and Claude Desktop bearer token must be updated to
  the new `WRAPPER_API_KEY`. Rotating `WRAPPER_API_KEY` also changes the
  OAuth user's password, so claude.ai's connector will need to sign in
  again. To rotate an OAuth client's secret, run
  `npm run deploy:remove-client -- <name>` then
  `npm run deploy:new-client -- <name>` and update the Advanced settings in
  the connector UI with the new pair. To wipe all OAuth state — every
  registered session, refresh token, and the JWKS signing key — as a
  clean-slate reset, delete the `oauth-state` secret and re-deploy; users
  will need to re-authorize.

## License

[Apache License 2.0](./LICENSE).
