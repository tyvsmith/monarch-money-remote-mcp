// Reads the `oauth-clients` GCP Secret Manager secret — a JSON array of
// pre-registered trusted OAuth clients — and maps each entry into the shape
// better-auth's oidc-provider plugin expects under `trustedClients`.
//
// Mirrors the lazy-init + availability-gating pattern in
// src/auth/secret-manager-adapter.ts and src/session-store.ts. Read-only:
// the CLI commands in scripts/deploy.ts own writes to this secret.
//
// FAIL SOFT on cold start: if the secret is missing/empty AND legacy env
// vars `OAUTH_CLIENT_ID` + `OAUTH_CLIENT_SECRET` are still set, we build a
// single-entry list from those as a backwards-compat safety net. The real
// migration happens once in `scripts/deploy.ts --bootstrap`; this branch
// exists so a half-migrated deploy still boots with OAuth working.

import type { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const SECRET_NAME = process.env.OAUTH_CLIENTS_SECRET_NAME ?? 'oauth-clients';

// The shape better-auth's oidcProvider plugin accepts for each entry of its
// `trustedClients` option. We construct this exactly; missing fields like
// `metadata`/`icon` are required by the type signature even when null.
export interface TrustedClient {
  clientId: string;
  clientSecret: string;
  redirectUrls: string[];
  name: string;
  skipConsent: boolean;
  type: 'web';
  disabled: boolean;
  metadata: null;
  icon: undefined;
}

// Raw shape stored in the `oauth-clients` secret JSON blob. Keep this minimal
// — the runtime never writes it (the deploy CLI does), so any extra fields
// stored by future versions should be ignored gracefully.
interface RawClient {
  name: string;
  clientId: string;
  clientSecret: string;
  redirects: string[];
  skipConsent?: boolean;
}

function isAvailable(): boolean {
  if (process.env.OAUTH_STATE_FORCE_ENABLE === '1') return true;
  if (process.env.K_SERVICE || process.env.K_REVISION) return true;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  return false;
}

function projectId(): string | null {
  return process.env.GCP_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? null;
}

function secretParent(): string | null {
  const p = projectId();
  return p ? `projects/${p}/secrets/${SECRET_NAME}` : null;
}

let smClient: SecretManagerServiceClient | null = null;
let clientLoadFailed = false;
async function getClient(): Promise<SecretManagerServiceClient | null> {
  if (clientLoadFailed) return null;
  if (smClient) return smClient;
  try {
    const mod = await import('@google-cloud/secret-manager');
    smClient = new mod.SecretManagerServiceClient();
    return smClient;
  } catch (err) {
    clientLoadFailed = true;
    console.warn(
      '[oauth-clients] could not initialise Secret Manager client:',
      err,
    );
    return null;
  }
}

async function loadRawClients(): Promise<RawClient[]> {
  if (!isAvailable()) return [];
  const parent = secretParent();
  if (!parent) return [];
  const client = await getClient();
  if (!client) return [];
  try {
    const [v] = await client.accessSecretVersion({
      name: `${parent}/versions/latest`,
    });
    const data = v.payload?.data;
    if (!data) return [];
    const s = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    if (!s.trim()) return [];
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn('[oauth-clients] secret payload is not a JSON array');
      return [];
    }
    return parsed.filter(isValidRaw);
  } catch (err: unknown) {
    const code = (err as { code?: number | string })?.code;
    // 5 = NOT_FOUND (first run, no version yet) — silent.
    // 7 = PERMISSION_DENIED — silent.
    if (code !== 5 && code !== 7) {
      console.warn('[oauth-clients] failed to load saved state:', err);
    }
    return [];
  }
}

function isValidRaw(x: unknown): x is RawClient {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.name === 'string' &&
    typeof r.clientId === 'string' &&
    typeof r.clientSecret === 'string' &&
    Array.isArray(r.redirects) &&
    r.redirects.every((u) => typeof u === 'string')
  );
}

function toTrusted(r: RawClient): TrustedClient {
  return {
    clientId: r.clientId,
    clientSecret: r.clientSecret,
    redirectUrls: r.redirects,
    name: r.name,
    skipConsent: r.skipConsent ?? true,
    type: 'web',
    disabled: false,
    metadata: null,
    icon: undefined,
  };
}

/**
 * Load trusted-client list for better-auth's oidcProvider.
 *
 * Order:
 *   1. Secret Manager `oauth-clients` JSON array (canonical).
 *   2. If empty AND legacy `OAUTH_CLIENT_ID` + `OAUTH_CLIENT_SECRET` env vars
 *      are set, synthesise a single "claude" entry (one-shot safety net for
 *      a half-migrated deploy — bootstrap fully migrates this on next run).
 *   3. Otherwise empty array — OAuth is effectively unusable (no client can
 *      authorize), but the server still serves static-key traffic. A warning
 *      is logged so the operator notices.
 */
export async function loadTrustedClients(): Promise<TrustedClient[]> {
  const raw = await loadRawClients();
  if (raw.length > 0) {
    return raw.map(toTrusted);
  }

  // Safety-net: legacy env vars from a half-migrated deploy.
  const legacyId = process.env.OAUTH_CLIENT_ID;
  const legacySecret = process.env.OAUTH_CLIENT_SECRET;
  if (legacyId && legacySecret) {
    console.warn(
      '[oauth-clients] secret empty, falling back to legacy OAUTH_CLIENT_ID/OAUTH_CLIENT_SECRET env vars — run `npm run deploy:bootstrap` to migrate',
    );
    return [
      toTrusted({
        name: 'claude',
        clientId: legacyId,
        clientSecret: legacySecret,
        redirects: [
          'https://claude.ai/api/mcp/auth_callback',
          'https://claude.com/api/mcp/auth_callback',
        ],
        skipConsent: true,
      }),
    ];
  }

  console.warn(
    '[oauth-clients] no trusted clients configured — OAuth flow will reject all clients. Add one with `npm run deploy:new-client -- <name>`.',
  );
  return [];
}
