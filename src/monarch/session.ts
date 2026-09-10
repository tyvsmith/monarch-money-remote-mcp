// One authenticated MonarchClient for the process. Resumes the persisted
// session (token + device UUID), validates it, and logs in only through a
// single-flight refresh that also owns the cooldown, so neither a cold start
// nor a burst of 401s can send more than one login at a time or retry into a
// lockout.
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { createClient, MonarchError, type MonarchClient } from './client.ts';
import { login } from './login.ts';
import { loadSavedSession, saveSession, type SavedSession } from '../session-store.ts';

const COOLDOWN_MS = 60 * 60 * 1000;
const VALIDATE_Q = /* GraphQL */ `query SessionCheck { me { id } }`;
// Login outcomes a server cannot recover from by retrying; each retry makes it worse.
const COOLDOWN_CODES = new Set(['RATE_LIMIT', 'CAPTCHA_REQUIRED', 'EMAIL_OTP_REQUIRED']);

let session: SavedSession | null = null;
let client: MonarchClient | null = null;
let pendingClient: Promise<MonarchClient> | null = null;
let pendingLogin: Promise<SavedSession> | null = null;
let cooldownUntil = 0;

function cooldownError(): MonarchError {
  return new MonarchError(
    `Monarch login cooldown until ${new Date(cooldownUntil).toISOString()}; retrying earlier extends the lockout`,
    503,
    'COOLDOWN',
  );
}

/** Single-flight login. Concurrent callers share one attempt; failures that retrying would worsen start the cooldown. */
function refreshSession(deviceUuid: string): Promise<SavedSession> {
  if (Date.now() < cooldownUntil) return Promise.reject(cooldownError());
  if (pendingLogin) return pendingLogin;
  pendingLogin = login({
    email: config.monarchEmail,
    password: config.monarchPassword,
    mfaSecret: config.monarchMfaSecret,
    deviceUuid,
    baseUrl: config.monarchBaseUrl,
  })
    .then(({ token }) => {
      session = { token, deviceUuid };
      void saveSession(session);
      return session;
    })
    .catch((err) => {
      if (err instanceof MonarchError && err.code && COOLDOWN_CODES.has(err.code)) {
        cooldownUntil = Date.now() + COOLDOWN_MS;
        console.error(`[monarch] login ${err.code}; cooldown until ${new Date(cooldownUntil).toISOString()}`);
      }
      throw err;
    })
    .finally(() => {
      pendingLogin = null;
    });
  return pendingLogin;
}

function makeClient(): MonarchClient {
  return createClient({
    baseUrl: config.monarchBaseUrl,
    deviceUuid: session!.deviceUuid,
    token: async () => session!.token,
    onUnauthorized: async (rejectedToken) => {
      // A request sent with the old token can 401 after a sibling already refreshed; retrying with the new token is enough.
      if (rejectedToken !== session!.token) return;
      console.warn('[monarch] token rejected; refreshing session');
      await refreshSession(session!.deviceUuid);
    },
  });
}

async function build(): Promise<MonarchClient> {
  const deviceUuid = config.monarchDeviceUuid ?? randomUUID();
  const saved = await loadSavedSession(deviceUuid);
  if (saved) {
    session = saved;
    const c = makeClient();
    try {
      await c.query(VALIDATE_Q);
      console.log('[monarch] resumed saved session');
      // A legacy bare-token secret carries no UUID; persist the one we chose so it stays stable.
      if (!config.monarchDeviceUuid) void saveSession(saved);
      return c;
    } catch (err) {
      // Only an explicit token rejection justifies spending a login; anything else is not the token.
      if (!(err instanceof MonarchError && err.statusCode === 401)) throw err;
      console.log('[monarch] saved session invalid; logging in');
    }
  } else if (!config.monarchDeviceUuid) {
    console.warn('[monarch] no saved session and no MONARCH_DEVICE_UUID; logging in as a new device (run npm run monarch:enroll to avoid this)');
  }
  await refreshSession(saved?.deviceUuid ?? deviceUuid);
  return makeClient();
}

/** Test seam: inject a fake client so tool handlers can be unit-tested offline. */
export function setMonarchClientForTests(c: MonarchClient | null): void {
  client = c;
}

export async function getMonarch(): Promise<MonarchClient> {
  if (client) return client;
  if (Date.now() < cooldownUntil) throw cooldownError();
  if (pendingClient) return pendingClient;
  pendingClient = build()
    .then((c) => {
      client = c;
      return c;
    })
    .finally(() => {
      pendingClient = null;
    });
  return pendingClient;
}
