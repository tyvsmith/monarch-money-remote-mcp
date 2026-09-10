function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

// Resolve the public issuer URL for OAuth metadata. Prefer an explicit
// ISSUER_URL (recommended for Cloud Run + tagged revisions); fall back to a
// localhost URL keyed off the active port for dev.
function resolveIssuerUrl(port: number): string {
  const explicit = optional('ISSUER_URL');
  if (explicit) return explicit.replace(/\/$/, '');
  return `http://localhost:${port}`;
}

const port = Number(process.env.PORT ?? 8080);

// Monarch credentials are read lazily so tooling (tests, gen-openapi,
// check-ops) can import tool modules without a configured environment. The
// server still fails fast: src/index.ts touches them at boot.
export const config = {
  get monarchEmail(): string {
    return required('MONARCH_EMAIL');
  },
  get monarchPassword(): string {
    return required('MONARCH_PASSWORD');
  },
  monarchMfaSecret: optional('MONARCH_MFA_SECRET'),
  monarchBaseUrl: (optional('MONARCH_BASE_URL') ?? 'https://api.monarch.com').replace(/\/$/, ''),
  // Device UUID Monarch already trusts for this login (set by `npm run
  // monarch:enroll`). A fresh UUID looks like a new device and can trigger an
  // email OTP or CAPTCHA that a server cannot answer, so keep it stable.
  monarchDeviceUuid: optional('MONARCH_DEVICE_UUID'),
  get wrapperApiKey(): string {
    return required('WRAPPER_API_KEY');
  },
  port,
  // ----- OAuth 2.1 (better-auth) -----
  // Single end-user identity used by the credentials provider. Password is
  // intentionally aliased to the existing wrapperApiKey so operators only
  // manage one secret.
  authUserEmail: optional('AUTH_USER_EMAIL') ?? 'user@monarch-money-remote-mcp.local',
  // Pre-registered OAuth clients now live in the `oauth-clients` Secret
  // Manager blob, loaded at boot by src/auth/oauth-clients.ts. The CLI
  // commands `npm run deploy:new-client|list-clients|remove-client` manage
  // entries. Legacy `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` env vars are
  // still consulted as a one-shot safety net during migration; see
  // src/auth/oauth-clients.ts.
  // Public issuer URL the service advertises in OAuth metadata (and that
  // signed JWTs use for `iss`). Defaults to localhost in dev.
  issuerUrl: resolveIssuerUrl(port),
} as const;
