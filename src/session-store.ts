// Persist the Monarch session (token + trusted device UUID) so cold starts
// can skip the full login. Tokens issued by /auth/login/ carry no expiration;
// the device UUID is what lets a future login skip Monarch's new-device
// email OTP, so it travels with the token.
//
// Backend: GCP Secret Manager when running on Cloud Run (or forced), else a
// local JSON file (MONARCH_SESSION_FILE, default .monarch-session.json) for
// development and the enroll command.
//
// Gated on running inside Cloud Run (K_SERVICE env var) or having an explicit
// ADC override (GOOGLE_APPLICATION_CREDENTIALS, or
// SESSION_STORE_FORCE_ENABLE=1 for testing). Otherwise no-ops cleanly — the
// google-cloud client lib throws into uncaught promises during ADC lookup
// when no credentials are available, so we MUST avoid instantiating it when
// we know we don't have creds.

import { readFile, writeFile } from 'node:fs/promises';
import type { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const SECRET_NAME = process.env.SESSION_SECRET_NAME ?? 'monarch-session';
const LOCAL_FILE = process.env.MONARCH_SESSION_FILE ?? '.monarch-session.json';

export interface SavedSession {
  token: string;
  deviceUuid: string;
}

/** Accepts the JSON form and the legacy bare-token form. */
export function parseSavedSession(raw: string, fallbackDeviceUuid: string): SavedSession | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith('{')) {
    const j = JSON.parse(s) as Partial<SavedSession>;
    return j.token ? { token: j.token, deviceUuid: j.deviceUuid ?? fallbackDeviceUuid } : null;
  }
  return { token: s, deviceUuid: fallbackDeviceUuid };
}

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

async function readRaw(): Promise<string | null> {
  if (!isAvailable()) {
    try {
      return await readFile(LOCAL_FILE, 'utf8');
    } catch {
      return null;
    }
  }
  const parent = secretParent();
  if (!parent) return null;
  const client = await getClient();
  if (!client) return null;
  try {
    const [v] = await client.accessSecretVersion({ name: `${parent}/versions/latest` });
    const data = v.payload?.data;
    if (!data) return null;
    return Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  } catch (err: unknown) {
    const code = (err as { code?: number | string })?.code;
    // 5 = NOT_FOUND (first run, no version yet), 7 = PERMISSION_DENIED: silent.
    if (code !== 5 && code !== 7) console.warn('[session-store] failed to load saved session:', err);
    return null;
  }
}

export async function loadSavedSession(fallbackDeviceUuid: string): Promise<SavedSession | null> {
  const raw = await readRaw();
  if (raw === null) return null;
  try {
    return parseSavedSession(raw, fallbackDeviceUuid);
  } catch (err) {
    console.warn('[session-store] saved session is not valid JSON; ignoring:', err);
    return null;
  }
}

export async function saveSession(s: SavedSession): Promise<void> {
  if (!s.token) return;
  const payload = JSON.stringify({ token: s.token, deviceUuid: s.deviceUuid });
  if (!isAvailable()) {
    await writeFile(LOCAL_FILE, payload + '\n', { mode: 0o600 });
    console.log(`[session-store] saved session to ${LOCAL_FILE}`);
    return;
  }
  const parent = secretParent();
  if (!parent) return;
  const client = await getClient();
  if (!client) return;
  try {
    await client.addSecretVersion({ parent, payload: { data: Buffer.from(payload, 'utf8') } });
    console.log('[session-store] saved new session version');
  } catch (err: unknown) {
    console.warn('[session-store] failed to save session:', err);
  }
}

// Legacy wrappers for src/monarch-client.ts; removed with the SDK.
export async function loadSavedToken(): Promise<string | null> {
  return (await loadSavedSession('legacy'))?.token ?? null;
}
export async function saveToken(token: string): Promise<void> {
  await saveSession({ token, deviceUuid: process.env.MONARCH_DEVICE_UUID ?? 'legacy' });
}
