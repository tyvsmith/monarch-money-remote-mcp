// Persist the Monarch session token to GCP Secret Manager so cold starts
// can skip the full login. Token validity is ~1 year per the SDK maintainer.
//
// Gated on running inside Cloud Run (K_SERVICE env var) or having an explicit
// ADC override (GOOGLE_APPLICATION_CREDENTIALS, or
// SESSION_STORE_FORCE_ENABLE=1 for testing). Otherwise no-ops cleanly — the
// google-cloud client lib throws into uncaught promises during ADC lookup
// when no credentials are available, so we MUST avoid instantiating it when
// we know we don't have creds.

import type { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const SECRET_NAME = process.env.SESSION_SECRET_NAME ?? 'monarch-session';

function isAvailable(): boolean {
  if (process.env.SESSION_STORE_FORCE_ENABLE === '1') return true;
  // Cloud Run / Cloud Functions / App Engine set one of these automatically.
  if (process.env.K_SERVICE || process.env.K_REVISION) return true;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  return false;
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
    console.warn('[session-store] could not initialise Secret Manager client:', err);
    return null;
  }
}

function projectId(): string | null {
  return process.env.GCP_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? null;
}

function secretParent(): string | null {
  const p = projectId();
  return p ? `projects/${p}/secrets/${SECRET_NAME}` : null;
}

export async function loadSavedToken(): Promise<string | null> {
  if (!isAvailable()) return null;
  const parent = secretParent();
  if (!parent) return null;
  const client = await getClient();
  if (!client) return null;
  try {
    const [v] = await client.accessSecretVersion({
      name: `${parent}/versions/latest`,
    });
    const data = v.payload?.data;
    if (!data) return null;
    const s = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    return s.trim() || null;
  } catch (err: unknown) {
    const code = (err as { code?: number | string })?.code;
    // 5 = NOT_FOUND (first run, no version yet) — silent.
    // 7 = PERMISSION_DENIED — silent.
    if (code !== 5 && code !== 7) {
      console.warn('[session-store] failed to load saved token:', err);
    }
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  if (!isAvailable()) return;
  const parent = secretParent();
  if (!parent) return;
  if (!token) return;
  const client = await getClient();
  if (!client) return;
  try {
    await client.addSecretVersion({
      parent,
      payload: { data: Buffer.from(token, 'utf8') },
    });
    console.log('[session-store] saved new session token version');
  } catch (err: unknown) {
    console.warn('[session-store] failed to save session token:', err);
  }
}
