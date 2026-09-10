// One authenticated MonarchClient for the process. Resumes the persisted
// session (token + device UUID), validates it, and logs in once if needed.
// A 429 or CAPTCHA on login starts a one-hour cooldown so retries cannot
// extend a lockout.
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { createClient, MonarchError, type MonarchClient } from './client.ts';
import { login } from './login.ts';
import { loadSavedSession, saveSession, type SavedSession } from '../session-store.ts';

const COOLDOWN_MS = 60 * 60 * 1000;
const VALIDATE_Q = /* GraphQL */ `query SessionCheck { me { id } }`;

let session: SavedSession | null = null;
let client: MonarchClient | null = null;
let pending: Promise<MonarchClient> | null = null;
let cooldownUntil = 0;

async function freshLogin(deviceUuid: string): Promise<SavedSession> {
  const { token } = await login({
    email: config.monarchEmail,
    password: config.monarchPassword,
    mfaSecret: config.monarchMfaSecret,
    deviceUuid,
    baseUrl: config.monarchBaseUrl,
  });
  const s = { token, deviceUuid };
  void saveSession(s);
  return s;
}

function makeClient(): MonarchClient {
  return createClient({
    baseUrl: config.monarchBaseUrl,
    deviceUuid: session!.deviceUuid,
    token: async () => session!.token,
    onUnauthorized: async () => {
      console.warn('[monarch] token rejected; logging in once');
      session = await freshLogin(session!.deviceUuid);
    },
  });
}

async function build(): Promise<MonarchClient> {
  const deviceUuid = config.monarchDeviceUuid ?? randomUUID();
  session = await loadSavedSession(deviceUuid);
  if (session) {
    const c = makeClient();
    try {
      await c.query(VALIDATE_Q);
      console.log('[monarch] resumed saved session');
      return c;
    } catch (err) {
      if (!(err instanceof MonarchError && err.statusCode === 401)) throw err;
      console.log('[monarch] saved session invalid; logging in');
    }
  } else if (!config.monarchDeviceUuid) {
    console.warn('[monarch] no saved session and no MONARCH_DEVICE_UUID; logging in as a new device (run npm run monarch:enroll to avoid this)');
  }
  session = await freshLogin(session?.deviceUuid ?? deviceUuid);
  return makeClient();
}

export async function getMonarch(): Promise<MonarchClient> {
  if (client) return client;
  if (Date.now() < cooldownUntil) {
    throw new MonarchError(
      `Monarch login cooldown until ${new Date(cooldownUntil).toISOString()}; retrying earlier extends the lockout`,
      503,
      'COOLDOWN',
    );
  }
  if (pending) return pending;
  pending = build()
    .then((c) => {
      client = c;
      return c;
    })
    .catch((err) => {
      if (err instanceof MonarchError && (err.code === 'RATE_LIMIT' || err.code === 'CAPTCHA_REQUIRED')) {
        cooldownUntil = Date.now() + COOLDOWN_MS;
        console.error(`[monarch] ${err.code}; cooldown until ${new Date(cooldownUntil).toISOString()}`);
      }
      throw err;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function resetMonarch(): void {
  client = null;
  session = null;
  cooldownUntil = 0;
}
