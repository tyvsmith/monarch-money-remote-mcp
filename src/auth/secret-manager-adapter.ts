// Better-auth adapter that persists state to a single GCP Secret Manager
// secret. Mirrors the pattern in src/session-store.ts: lazy client init, no-op
// when no GCP credentials are available, version cleanup left to GCP's
// existing retention (Secret Manager retains old versions until destroyed).
//
// Design: we use better-auth's `memoryAdapter` as the in-memory data plane,
// then wrap it so every mutation flushes the entire MemoryDB JSON to a single
// Secret Manager secret. Reads always hit memory. Cold start hydrates the
// memory from the latest secret version.
//
// State is small (one user, one OAuth client, a few sessions/refresh tokens
// at a time) so a single-blob model is appropriate.
//
// FAIL LOUD: if persistence is required (i.e. we're running in Cloud Run and
// the secret container exists) and Secret Manager errors, we surface the
// error to the caller. We do not silently swallow writes — losing OAuth state
// would break Claude reconnection.

import type { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory';
import type { BetterAuthOptions } from 'better-auth';

const SECRET_NAME = process.env.OAUTH_STATE_SECRET_NAME ?? 'oauth-state';
// Debounce flushes so a burst of writes (e.g. authorize → token in one flow)
// turns into a single Secret Manager version add.
const FLUSH_DEBOUNCE_MS = 250;
// Hard cap version count to keep so the secret doesn't accumulate unbounded
// history (Secret Manager bills per active version).
const MAX_VERSIONS_TO_KEEP = 5;

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
      '[oauth-state] could not initialise Secret Manager client:',
      err,
    );
    return null;
  }
}

async function loadInitialState(): Promise<MemoryDB> {
  if (!isAvailable()) return {};
  const parent = secretParent();
  if (!parent) return {};
  const client = await getClient();
  if (!client) return {};
  try {
    const [v] = await client.accessSecretVersion({
      name: `${parent}/versions/latest`,
    });
    const data = v.payload?.data;
    if (!data) return {};
    const s = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    if (!s.trim()) return {};
    const parsed = JSON.parse(s) as MemoryDB;
    // Dates lose their type through JSON; rehydrate any ISO strings that
    // better-auth tagged as dates (it tags by field schema, not by value, so
    // we rely on its own input normalization downstream).
    return revivedDates(parsed);
  } catch (err: unknown) {
    const code = (err as { code?: number | string })?.code;
    // 5 = NOT_FOUND (first run, no version yet) — silent.
    // 7 = PERMISSION_DENIED — silent in dev; would fail loudly in prod via
    //     the next write attempt.
    if (code !== 5 && code !== 7) {
      console.warn('[oauth-state] failed to load saved state:', err);
    }
    return {};
  }
}

function revivedDates(db: MemoryDB): MemoryDB {
  // ISO-8601 dates that better-auth writes serialize as strings under JSON.
  // Convert anything that looks like a YYYY-MM-DDTHH:MM:SS... back to Date.
  const isoLike = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  const out: MemoryDB = {};
  for (const [model, rows] of Object.entries(db)) {
    if (!Array.isArray(rows)) continue;
    out[model] = rows.map((row: Record<string, unknown>) => {
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === 'string' && isoLike.test(v)) {
          const d = new Date(v);
          r[k] = Number.isNaN(d.getTime()) ? v : d;
        } else {
          r[k] = v;
        }
      }
      return r;
    });
  }
  return out;
}

async function cleanupOldVersions(
  client: SecretManagerServiceClient,
  parent: string,
): Promise<void> {
  try {
    const [versions] = await client.listSecretVersions({ parent });
    const enabled = versions.filter(
      (v) => v.state === 'ENABLED' || v.state === 1,
    );
    if (enabled.length <= MAX_VERSIONS_TO_KEEP) return;
    // listSecretVersions returns newest first per GCP defaults; play safe and
    // sort by createTime descending.
    enabled.sort((a, b) => {
      const ta = Number(a.createTime?.seconds ?? 0);
      const tb = Number(b.createTime?.seconds ?? 0);
      return tb - ta;
    });
    const toDestroy = enabled.slice(MAX_VERSIONS_TO_KEEP);
    for (const v of toDestroy) {
      if (!v.name) continue;
      try {
        await client.destroySecretVersion({ name: v.name });
      } catch (err) {
        console.warn('[oauth-state] failed to destroy old version', v.name, err);
      }
    }
  } catch (err) {
    console.warn('[oauth-state] version cleanup failed:', err);
  }
}

class SecretManagerPersister {
  private db: MemoryDB;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;

  constructor(db: MemoryDB) {
    this.db = db;
  }

  markDirty(): void {
    if (!isAvailable()) return;
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
    // Don't keep the process alive purely because of a pending flush.
    this.flushTimer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.dirty) return;
    this.dirty = false;
    const parent = secretParent();
    if (!parent) return;
    const client = await getClient();
    if (!client) return;

    const snapshot = JSON.stringify(this.db);
    this.flushing = (async () => {
      try {
        await client.addSecretVersion({
          parent,
          payload: { data: Buffer.from(snapshot, 'utf8') },
        });
        await cleanupOldVersions(client, parent);
      } catch (err) {
        // FAIL LOUD: re-mark dirty so the next mutation retries, and surface.
        this.dirty = true;
        console.error('[oauth-state] failed to persist OAuth state:', err);
        throw err;
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }
}

export interface SecretManagerAdapterHandle {
  /** The better-auth-compatible adapter factory. */
  adapter: ReturnType<typeof memoryAdapter>;
  /** Force-flush any pending write (useful for tests). */
  flush(): Promise<void>;
}

// Pre-create all table arrays the better-auth core schema + our enabled
// plugins need. The memoryAdapter's `create` will lazy-init a model on
// first insert, but `findOne`/`findMany` throw before any insert if the key
// is missing — and seeding "user not found" checks happen on boot.
const KNOWN_MODELS = [
  // Core schema
  'user',
  'session',
  'account',
  'verification',
  // jwt plugin
  'jwks',
  // oidc-provider plugin
  'oauthApplication',
  'oauthAccessToken',
  'oauthConsent',
] as const;

function ensureTables(db: MemoryDB): void {
  for (const m of KNOWN_MODELS) {
    if (!Array.isArray(db[m])) db[m] = [];
  }
}

export async function createSecretManagerAdapter(): Promise<SecretManagerAdapterHandle> {
  const initial = await loadInitialState();
  const db: MemoryDB = initial;
  ensureTables(db);
  const persister = new SecretManagerPersister(db);

  // Wrap memoryAdapter so every write triggers a debounced flush. The shape
  // of the adapter is the standard better-auth DBAdapter — we only intercept
  // the mutating verbs.
  const inner = memoryAdapter(db);

  // We have to wrap at the BetterAuthOptions-applying layer because the inner
  // factory only takes options once at construction. The returned function
  // produces the actual DBAdapter instance.
  const wrapped: ReturnType<typeof memoryAdapter> = (options: BetterAuthOptions) => {
    const concrete = inner(options);
    const mark = () => persister.markDirty();
    return new Proxy(concrete, {
      get(target, prop, receiver) {
        const orig = Reflect.get(target, prop, receiver);
        if (typeof orig !== 'function') return orig;
        if (
          prop === 'create' ||
          prop === 'update' ||
          prop === 'updateMany' ||
          prop === 'delete' ||
          prop === 'deleteMany' ||
          prop === 'consumeOne'
        ) {
          return async (...args: unknown[]) => {
            const result = await (orig as (...a: unknown[]) => unknown).apply(
              target,
              args,
            );
            mark();
            return result;
          };
        }
        return (orig as (...a: unknown[]) => unknown).bind(target);
      },
    });
  };

  return {
    adapter: wrapped,
    flush: () => persister.flush(),
  };
}
