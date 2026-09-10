import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, MonarchError } from '../../src/monarch/client.ts';

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

test('query sends required headers and returns data', async () => {
  const f = fakeFetch([{ status: 200, body: { data: { me: { id: '1' } } } }]);
  const c = createClient({ token: async () => 'tok', deviceUuid: 'dev', fetchImpl: f.impl });
  const data = await c.query<{ me: { id: string } }>('query { me { id } }');
  assert.equal(data.me.id, '1');
  const h = f.calls[0]!.init.headers as Record<string, string>;
  assert.equal(h.Authorization, 'Token tok');
  assert.equal(h['Device-UUID'], 'dev');
  assert.equal(h['Client-Platform'], 'web');
  assert.match(h['User-Agent']!, /Mozilla/);
  assert.equal(f.calls[0]!.url, 'https://api.monarch.com/graphql');
});

test('graphql errors become MonarchError with 502', async () => {
  const f = fakeFetch([{ status: 200, body: { errors: [{ message: 'boom', path: ['aggregates'] }], data: null } }]);
  const c = createClient({ token: async () => 'tok', deviceUuid: 'dev', fetchImpl: f.impl });
  await assert.rejects(
    c.query('query { me { id } }'),
    (e: unknown) => e instanceof MonarchError && e.statusCode === 502 && /boom/.test(e.message),
  );
});

test('401 triggers onUnauthorized and retries once', async () => {
  const f = fakeFetch([
    { status: 401, body: { detail: 'Invalid token.' } },
    { status: 200, body: { data: { me: { id: '2' } } } },
  ]);
  let refreshed = 0;
  const c = createClient({
    token: async () => 'tok',
    deviceUuid: 'dev',
    fetchImpl: f.impl,
    onUnauthorized: async () => { refreshed += 1; },
  });
  const data = await c.query<{ me: { id: string } }>('query { me { id } }');
  assert.equal(data.me.id, '2');
  assert.equal(refreshed, 1);
  assert.equal(f.calls.length, 2);
});

test('429 becomes MonarchError with code RATE_LIMIT', async () => {
  const f = fakeFetch([{ status: 429, body: { detail: 'slow down' } }]);
  const c = createClient({ token: async () => 'tok', deviceUuid: 'dev', fetchImpl: f.impl });
  await assert.rejects(
    c.query('query { me { id } }'),
    (e: unknown) => e instanceof MonarchError && e.statusCode === 429 && e.code === 'RATE_LIMIT',
  );
});

test('upload posts multipart to a REST path', async () => {
  const f = fakeFetch([{ status: 200, body: { session_key: 'abc' } }]);
  const c = createClient({ token: async () => 'tok', deviceUuid: 'dev', fetchImpl: f.impl });
  const form = new FormData();
  form.append('x', '1');
  const out = await c.upload<{ session_key: string }>('/account-balance-history/upload/', form);
  assert.equal(out.session_key, 'abc');
  assert.equal(f.calls[0]!.url, 'https://api.monarch.com/account-balance-history/upload/');
  assert.equal((f.calls[0]!.init.headers as Record<string, string>)['Content-Type'], undefined);
});
