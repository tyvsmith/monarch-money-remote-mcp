# monarch-money-remote-mcp

> **Status: stand-in for the paused official connector.** Monarch shipped an
> official [MCP connector](https://help.monarch.com/hc/en-us/articles/50207234679956-Monarch-MCP-Connector)
> in June 2026 and paused it on June 29 over a data-portability question from
> a data provider. This service mirrors that connector's 41-tool contract
> (same names, arguments, and semantics) over Monarch's private GraphQL API so
> prompts and workflows written against the official one keep working. When
> Monarch restores it, point clients at `https://api.monarch.com/mcp` directly;
> this service then becomes a fallback.

Single-tenant Cloud Run service that exposes a Monarch Money account to
**Claude Custom Connector** (MCP over Streamable HTTP), **ChatGPT
connectors** (same MCP endpoint), and **Custom GPT Actions** (REST + OpenAPI).

Tools: the 17 official read tools (`GetAccounts`, `GetTransactions`,
`GetBudget`, `GetCashFlow`, `GetCategories`, `GetGoals`, `GetInvestments`,
`GetMerchants`, `GetNetWorthHistory`, `GetRealEstate`, `GetRecurring`,
`GetSpendingByCategory`, `GetTags`, `GetCreditScoreHistory`,
`GetHouseholdMembers`, `GetBusinesses`, `ListRules`) plus the 24 write tools
(transactions, splits, bulk edits, categories, tags, merchants, rules, goals,
balance history, `ReportIssue`). **Writes are off by default**; set
`MONARCH_ENABLE_WRITES=1` on the service to expose them.

One container, three auth modes that all front the same handlers:

| Client | Endpoint | Auth |
|---|---|---|
| Claude Custom Connector (new) | `POST /mcp` | **OAuth 2.1** via `/api/auth/oauth2/*` (JWT-signing AS with JWKS at `/api/auth/jwks`) |
| Claude Custom Connector (legacy) | `POST /mcp` | `Authorization: Bearer <WRAPPER_API_KEY>` (still works) |
| Custom GPT Action | `POST /tools/{ToolName}` (body = tool args), `GET /tools` | `X-API-Key: <WRAPPER_API_KEY>` |

## Local dev

Requires Node 24+ (native TypeScript execution, no build step).

```bash
cp .env.example .env   # edit with your real Monarch creds + a random key
npm install
npm run dev            # node --watch src/index.ts, loads .env
```

Locally the Monarch session lives in `.monarch-session.json` (override with
`MONARCH_SESSION_FILE`). It is gitignored and not copied into the image.

Checks:

```bash
npm test               # unit tests + offline validation of every GraphQL operation against schema/monarch.graphql
npm run smoke          # live, read-only: calls every read tool against your account
KEY=$(grep WRAPPER_API_KEY .env | cut -d= -f2)
curl -s -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{}' localhost:8080/tools/GetTags
npx @modelcontextprotocol/inspector   # connect to http://localhost:8080/mcp with Authorization: Bearer <KEY>
```

The smoke script refuses write tools, and development never runs writes
against the owner's account (see `AGENTS.md`). Write handlers are covered by
unit tests with a scripted fake client (`test/helpers/fake-monarch.ts`). Their
GraphQL mutations were confirmed once during research, before that rule
existed, except `UpdateAccountBalanceHistory`, which is unverified against
the live API and says so in its description.

## Enroll the Monarch login (first time only)

Monarch gates `/auth/login/` behind a CAPTCHA and a new-device email code.
A login sent with `trusted_device: true` marks its `Device-UUID` as trusted,
after which logins from that UUID skip the email code. The service must
therefore always present the same UUID, and the first login should happen
from a laptop where you can read the email.

```bash
npm run monarch:enroll                         # logs in with .env creds; prompts for the emailed code if asked
npm run monarch:enroll -- --import ~/.mm/session.json   # or reuse a session an older SDK login created
```

On success it writes `MONARCH_DEVICE_UUID` to `.env` and the session
(`{token, deviceUuid}`) to `.monarch-session.json` (gitignored).
`npm run deploy:bootstrap` / `deploy:rotate-secrets` push both to Secret
Manager (`monarch-device-uuid`, `monarch-session`), so Cloud Run resumes the
enrolled session and never logs in as a new device. A secret created after
bootstrap gets the runtime service account's read binding automatically.

If Monarch answers `CAPTCHA_REQUIRED`, wait and retry from a different
network (home Wi-Fi, not a VPN or cloud host). There is no headless path
through the CAPTCHA. The account needs MFA enabled with the authenticator
secret in `MONARCH_MFA_SECRET`; tokens themselves do not expire.

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
     e.g., `monarch-money-remote-mcp-471203`). The ID, *not* the display name, is
     what goes in `.env` as `GCP_PROJECT_ID`.

2. **Link a billing account**
   → [console.cloud.google.com/billing](https://console.cloud.google.com/billing)
   - Required even though Cloud Run's free tier covers light personal use.
     New accounts get $300 of free credit and don't auto-charge after.
   - If you don't already have a billing account, the console walks you
     through creating one.

That's it for the console. Do **not** manually enable APIs, create service
accounts, or push secrets in the UI; the deploy script does all of that.

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
   # MONARCH_DEVICE_UUID (written by npm run monarch:enroll),
   # WRAPPER_API_KEY (generate: openssl rand -base64 48 | tr -d '\n'),
   # and GCP_PROJECT_ID (and GCP_REGION / GCP_SERVICE if you want non-defaults).
   ```

## Deploy to Cloud Run

```bash
npm run deploy:bootstrap   # first deploy: enables APIs, creates SA, pushes secrets, deploys
npm run deploy             # every deploy after that
```

`npm run deploy:bootstrap` runs `gcloud services enable` for
`run`, `cloudbuild`, `artifactregistry`, `secretmanager`, and `iam`, so no
manual API enablement is needed.

`npm run deploy` forwards `MONARCH_ENABLE_WRITES` from `.env` as a Cloud Run
env var, so flipping writes on or off is an edit to `.env` plus a deploy.

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
per-app callback URL like `https://chatgpt.com/connector/oauth/<id>`;
copy it from the New App dialog:

```bash
npm run deploy:new-client -- chatgpt --redirects=https://chatgpt.com/connector/oauth/7QoOc0y0-TnA
npm run deploy:new-client -- my-custom-app --redirects=https://example.com/oauth/cb,https://example.com/cb2
```

Names must match `/^[a-z0-9-]+$/`. The command refuses to overwrite an
existing entry; run `npm run deploy:remove-client -- <name>` first if you want
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
  (`user@<GCP_SERVICE>.local`, seeded by bootstrap; read it with
  `gcloud secrets versions access latest --secret=auth-user-email --project=$GCP_PROJECT_ID`)
- **Password**: the `WRAPPER_API_KEY` that was current when the user was first
  seeded (see Rotation below)

### Connect Claude (legacy `Authorization: Bearer KEY`)

The original setup still works for existing Claude integrations:

- URL: `<URL>/mcp`
- Advanced settings → **Authorization Token**: paste your `WRAPPER_API_KEY`.

## Connect Custom GPT

chatgpt.com → My GPTs → Edit → **Create new action**

1. Regenerate the schema with your URL: `PUBLIC_URL=https://<service>.run.app npm run gen-openapi`.
   GPT Actions allow 30 operations per action, so the document holds the 17
   read tools unless `MONARCH_ENABLE_WRITES=1` is set when generating (then
   split it into two actions).
2. Paste the generated `openapi.yaml` (gitignored, since it carries your URL)
   into the GPT Action schema field (it is JSON; the
   name is kept for existing setups).
3. Authentication → **API Key**, custom header `X-API-Key`, value is your
   wrapper API key.
4. Test the `GetAccounts` and `GetTransactions` operations from the GPT Builder.

ChatGPT's MCP connectors work too: register a `chatgpt` OAuth client (see
"Adding a new OAuth client" above) and add `<URL>/mcp` as a connector, the
same way the official Monarch connector was added.

## Notes

- **Writes are opt-in.** `MONARCH_ENABLE_WRITES=1` in `.env` exposes the 24
  write tools; `npm run deploy` forwards it to Cloud Run. MCP clients already confirm non-read-only tools with the user;
  `BulkUpdateTransactions`, `BulkRecategorizeTransactions`,
  `UpdateTransactionSplits`, and `UpdateAccountBalanceHistory` also take
  `dry_run: true` to preview. Monarch identifies merchants by name on writes,
  so `CreateMerchant` returns an existing id or tells the caller to pass
  `merchant_name`; every write tool that takes `merchant_id` accepts
  `merchant_name` too.
- **Schema is vendored.** `schema/monarch.graphql` comes from the web app
  bundle (`npm run extract-schema`); `npm run check-ops` validates every
  query offline. See `schema/README.md`.
- **Session persists across cold starts.** The `monarch-session` secret
  holds `{token, deviceUuid}` (seeded by `npm run monarch:enroll` +
  `deploy:rotate-secrets`). Cold starts load it, validate with one `me`
  query, and skip login. Tokens carry no expiration; if one is revoked the
  service logs in once with the trusted device UUID and saves a fresh
  session. Implementation: `src/session-store.ts` + `src/monarch/session.ts`.
- **Login cooldown (Monarch upstream).** Login is single-flight: concurrent
  requests share one attempt. If it returns `RATE_LIMIT` (HTTP 429),
  `CAPTCHA_REQUIRED`, or `EMAIL_OTP_REQUIRED`, the wrapper enters a 1-hour
  cooldown: incoming requests return HTTP 503 immediately without re-hitting
  Monarch, so a transient lockout doesn't escalate.
- **Auth-endpoint rate limits.** `/api/auth/sign-in/*` is limited to 10
  attempts per IP per 15 minutes; the rest of `/api/auth/*` (token refresh,
  JWKS, authorize) to 100. Returns HTTP 429 when exhausted. Cloud Run sits
  behind GFE, so the app trusts one proxy hop for accurate per-IP limiting.
- **OAuth state persists across cold starts.** All better-auth state
  (registered clients, sessions, refresh tokens, JWT signing keys) lives in
  a single `oauth-state` GCP Secret, write-through cached in memory by
  `src/auth/secret-manager-adapter.ts`. Rotating that secret invalidates
  every outstanding access/refresh token, which is acceptable for a single user.
- **Single seeded user.** The OAuth flow's login page accepts exactly one
  user (`AUTH_USER_EMAIL` + `WRAPPER_API_KEY` as password). Seeded
  idempotently in-process at boot. The public sign-up endpoint
  (`/api/auth/sign-up/*`) is blocked at the Express layer.
- **Rotation.** Edit `.env`, run `npm run deploy:rotate-secrets`. Then:
  Custom GPT `X-API-Key` and Claude Desktop bearer token must be updated to
  the new `WRAPPER_API_KEY`. Rotating `WRAPPER_API_KEY` does **not** change
  the OAuth user's password: the boot-time seed only creates the user, so the
  sign-in form keeps accepting the key that was current at first seed. To
  move it to the new key, do the clean-slate reset below, which re-seeds the
  user. To rotate an OAuth client's secret, run
  `npm run deploy:remove-client -- <name>` then
  `npm run deploy:new-client -- <name>` and update the Advanced settings in
  the connector UI with the new pair. To wipe all OAuth state (every
  registered session, refresh token, and the JWKS signing key) as a
  clean-slate reset, delete the `oauth-state` secret and run
  `npm run deploy:bootstrap` (the runtime only adds versions, so the empty
  container must be recreated; bootstrap is idempotent); users will need to
  re-authorize.

## License

[Apache License 2.0](./LICENSE).
