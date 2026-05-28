import { createRequire } from 'node:module';
import type {
  MonarchClient as MonarchClientType,
  ResponseFormatter as ResponseFormatterType,
} from 'monarchmoney';
import { config } from './config.ts';
import { loadSavedToken, saveToken } from './session-store.ts';

// monarchmoney 1.1.3 ships a broken ESM build (extensionless internal imports
// that Node strict ESM rejects). Load the CJS build via createRequire and keep
// the ESM types separately for type-checking.
const requireCjs = createRequire(import.meta.url);
const monarchCjs = requireCjs('monarchmoney') as {
  MonarchClient: new (...args: ConstructorParameters<typeof MonarchClientType>) => MonarchClientType;
  ResponseFormatter: typeof ResponseFormatterType;
};
const { MonarchClient } = monarchCjs;
export const ResponseFormatter = monarchCjs.ResponseFormatter;

// Monarch moved their API host from api.monarchmoney.com to api.monarch.com.
// The old host returns a 301 redirect that downgrades POST → GET, then the
// new host rejects with 405. Hardcoding the new host avoids the redirect.
// Override via MONARCH_BASE_URL env var if Monarch moves again.
const MONARCH_BASE_URL = process.env.MONARCH_BASE_URL ?? 'https://api.monarch.com';

// If Monarch rate-limits us, the SDK's retryWithBackoff has already amplified
// one call into up to 4 hits. We must NOT call the SDK again until the
// cooldown elapses, or we'll extend the lockout.
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

let cached: MonarchClientType | null = null;
let pending: Promise<MonarchClientType> | null = null;
let cooldownUntil: number | null = null;

async function tryResumeFromSavedToken(): Promise<MonarchClientType | null> {
  const savedToken = await loadSavedToken();
  if (!savedToken) return null;

  const client = new MonarchClient({ baseURL: MONARCH_BASE_URL });
  try {
    client.setToken(savedToken);
    const valid = await client.validateSession();
    if (valid) {
      console.log('[monarch-client] resumed from saved session token');
      return client;
    }
    console.log('[monarch-client] saved token invalid; will fall back to login');
  } catch (err) {
    console.warn('[monarch-client] saved token validation threw; falling back:', err);
  }
  return null;
}

async function freshLoginAndPersist(): Promise<MonarchClientType> {
  const client = new MonarchClient({ baseURL: MONARCH_BASE_URL });
  await client.login({
    email: config.monarchEmail,
    password: config.monarchPassword,
    mfaSecretKey: config.monarchMfaSecret,
    // saveSession=true is required: the SDK reads from its internal session
    // storage when validating subsequent GraphQL queries. We ALSO save the
    // token to Secret Manager below for cross-instance persistence.
    saveSession: true,
    useSavedSession: false,
  });
  const token = client.getSessionInfo().token;
  if (token) {
    // Fire-and-forget so the user request isn't held up by Secret Manager latency.
    void saveToken(token);
  }
  return client;
}

async function obtainClient(): Promise<MonarchClientType> {
  const resumed = await tryResumeFromSavedToken();
  if (resumed) return resumed;
  return freshLoginAndPersist();
}

function isRateLimitError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; name?: unknown };
  return e.code === 'RATE_LIMIT' || e.name === 'MonarchRateLimitError';
}

function cooldownError(): Error & { statusCode: number } {
  const until = new Date(cooldownUntil!).toISOString();
  const err = new Error(
    `Monarch rate-limit cooldown until ${until}. Retrying earlier will extend the lockout.`,
  ) as Error & { statusCode: number };
  err.statusCode = 503;
  return err;
}

export async function getMonarchClient(): Promise<MonarchClientType> {
  if (cached) return cached;
  if (cooldownUntil && Date.now() < cooldownUntil) throw cooldownError();
  if (pending) return pending;

  pending = obtainClient()
    .then((c) => {
      cooldownUntil = null;
      cached = c;
      return c;
    })
    .catch((err) => {
      if (isRateLimitError(err)) {
        cooldownUntil = Date.now() + COOLDOWN_MS;
        console.error(
          `[monarch-client] rate-limited; cooldown until ${new Date(cooldownUntil).toISOString()}`,
        );
      }
      throw err;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function resetMonarchClient(): void {
  cached = null;
  cooldownUntil = null;
}
