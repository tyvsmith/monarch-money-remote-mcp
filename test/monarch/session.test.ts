// Exercises the singleton through a fake global fetch. Tests share module state, so order matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONARCH_EMAIL = 'e';
process.env.MONARCH_PASSWORD = 'p';
process.env.MONARCH_DEVICE_UUID = 'dev';
process.env.WRAPPER_API_KEY = 'k';
process.env.MONARCH_SESSION_FILE = '/nonexistent-dir/session.json'; // save must fail quietly

const { getMonarch, setMonarchClientForTests } = await import('../../src/monarch/session.ts');

const state = { rejectNext: 0, loginStatus: 200, loginBody: { id: '1', token: 'fresh' } as Record<string, unknown>, logins: 0 };
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  if (String(url).endsWith('/auth/login/')) {
    state.logins += 1;
    return new Response(JSON.stringify(state.loginBody), { status: state.loginStatus });
  }
  const token = (init?.headers as Record<string, string>).Authorization;
  if (state.rejectNext > 0 || token !== 'Token fresh') {
    state.rejectNext = Math.max(0, state.rejectNext - 1);
    return new Response(JSON.stringify({ detail: 'Invalid token.' }), { status: 401 });
  }
  return new Response(JSON.stringify({ data: { me: { id: '1' } } }), { status: 200 });
}) as typeof fetch;

test('cold start with no saved session logs in once and caches the client', async () => {
  setMonarchClientForTests(null);
  const [a, b] = await Promise.all([getMonarch(), getMonarch()]);
  assert.equal(a, b);
  assert.equal(state.logins, 1);
});

test('concurrent 401s share one login', async () => {
  const c = await getMonarch();
  state.rejectNext = 2;
  const before = state.logins;
  await Promise.all([c.query('query { me { id } }'), c.query('query { me { id } }')]);
  assert.equal(state.logins - before, 1);
});

test('a CAPTCHA on re-login starts the cooldown; later calls fail fast without logging in', async () => {
  const c = await getMonarch();
  state.loginStatus = 403;
  state.loginBody = { detail: 'CAPTCHA is required to proceed.', error_code: 'CAPTCHA_REQUIRED' };
  state.rejectNext = 10;
  await assert.rejects(c.query('query { me { id } }'), (e: Error & { code?: string }) => e.code === 'CAPTCHA_REQUIRED');
  const before = state.logins;
  await assert.rejects(c.query('query { me { id } }'), (e: Error & { code?: string }) => e.code === 'COOLDOWN');
  setMonarchClientForTests(null);
  await assert.rejects(getMonarch(), (e: Error & { code?: string }) => e.code === 'COOLDOWN');
  assert.equal(state.logins, before);
});

test('a 401 carrying an already-replaced token does not log in again', async () => {
  // Reset cooldown state by re-importing is not possible; exercise the client hook directly instead.
  const { createClient } = await import('../../src/monarch/client.ts');
  let current = 'old';
  let refreshes = 0;
  const c = createClient({
    token: async () => current,
    deviceUuid: 'dev',
    fetchImpl: (async (_url: string | URL, init?: RequestInit) => {
      const t = (init?.headers as Record<string, string>).Authorization;
      return t === 'Token new'
        ? new Response(JSON.stringify({ data: { me: { id: '1' } } }), { status: 200 })
        : new Response(JSON.stringify({ detail: 'Invalid token.' }), { status: 401 });
    }) as typeof fetch,
    onUnauthorized: async (rejected) => {
      if (rejected !== current) return; // stale; sibling already refreshed
      refreshes += 1;
      current = 'new';
    },
  });
  await Promise.all([c.query('query { me { id } }'), c.query('query { me { id } }')]);
  assert.equal(refreshes, 1);
});
