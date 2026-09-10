// Thin client for Monarch's private API: GraphQL at /graphql plus a few REST
// endpoints (login, uploads). Owns the header set Monarch requires and maps
// transport and GraphQL failures onto one error type.

export class MonarchError extends Error {
  statusCode: number;
  code?: string;
  details?: unknown;
  constructor(message: string, statusCode: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'MonarchError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

// Cloudflare rejects the default Node user agent with a 403; the rest mirror
// what the web app sends so requests look like a browser session.
export const MONARCH_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Client-Platform': 'web',
  Origin: 'https://app.monarch.com',
  Referer: 'https://app.monarch.com/',
  'Monarch-Client': 'monarch-core-web-app-graphql',
  Accept: 'application/json',
});

export const DEFAULT_BASE_URL = 'https://api.monarch.com';

export interface ClientOptions {
  baseUrl?: string;
  token: () => Promise<string>;
  deviceUuid: string;
  /** Called on a 401 with the token that was rejected; the request is retried once afterwards. */
  onUnauthorized?: (rejectedToken: string) => Promise<void>;
  fetchImpl?: typeof fetch;
}

export interface MonarchClient {
  query<T>(document: string, variables?: Record<string, unknown>, operationName?: string): Promise<T>;
  /** Multipart upload to a REST path such as /account-balance-history/upload/ */
  upload<T>(path: string, form: FormData): Promise<T>;
}

interface GraphQLErrorShape {
  message: string;
  path?: unknown[];
  locations?: unknown[];
}

export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

export function httpError(res: Response, body: unknown): MonarchError {
  const b = body as { detail?: string; error_code?: string } | null;
  const detail = b?.detail ?? b?.error_code ?? '';
  if (res.status === 429) return new MonarchError(`Monarch rate limited: ${detail}`.trim(), 429, 'RATE_LIMIT', body);
  if (res.status === 401) {
    return new MonarchError(`Monarch rejected the session token: ${detail}`.trim(), 401, 'UNAUTHORIZED', body);
  }
  if (res.status === 403) {
    return new MonarchError(
      `Monarch forbade the request (Cloudflare or CSRF): ${detail}`.trim(),
      403,
      b?.error_code ?? 'FORBIDDEN',
      body,
    );
  }
  return new MonarchError(`Monarch HTTP ${res.status}: ${detail}`.trim(), res.status >= 400 ? res.status : 502, 'HTTP', body);
}

export function createClient(opts: ClientOptions): MonarchClient {
  const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function send(path: string, init: RequestInit, retry = true): Promise<Response> {
    const token = await opts.token();
    const headers: Record<string, string> = {
      ...MONARCH_HEADERS,
      Authorization: `Token ${token}`,
      'Device-UUID': opts.deviceUuid,
      ...(init.headers as Record<string, string> | undefined),
    };
    const res = await fetchImpl(`${base}${path}`, { ...init, headers });
    if (res.status === 401 && retry && opts.onUnauthorized) {
      await opts.onUnauthorized(token);
      return send(path, init, false);
    }
    return res;
  }

  return {
    async query<T>(document: string, variables: Record<string, unknown> = {}, operationName?: string): Promise<T> {
      const payload = operationName ? { query: document, variables, operationName } : { query: document, variables };
      const res = await send('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await readJson(res);
      if (!res.ok) throw httpError(res, body);
      const gql = body as { data?: T | null; errors?: GraphQLErrorShape[] };
      if (gql.errors?.length) {
        const msg = gql.errors.map((e) => `${e.message}${e.path ? ` at ${e.path.join('.')}` : ''}`).join('; ');
        throw new MonarchError(`Monarch GraphQL error: ${msg}`, 502, 'GRAPHQL', gql.errors);
      }
      if (gql.data === undefined || gql.data === null) {
        throw new MonarchError('Monarch GraphQL returned no data', 502, 'GRAPHQL');
      }
      return gql.data;
    },
    async upload<T>(path: string, form: FormData): Promise<T> {
      // No Content-Type: fetch sets the multipart boundary itself.
      const res = await send(path, { method: 'POST', body: form });
      const body = await readJson(res);
      if (!res.ok) throw httpError(res, body);
      return body as T;
    },
  };
}
