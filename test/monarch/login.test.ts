import { test } from 'node:test';
import assert from 'node:assert/strict';
import { login } from '../../src/monarch/login.ts';
import { MonarchError } from '../../src/monarch/client.ts';

function capture(status: number, body: unknown) {
  const seen: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

test('login posts the web-app payload with a TOTP and returns the token', async () => {
  const { fetchImpl, seen } = capture(200, { id: '42', token: 'abc', tokenExpiration: null });
  const out = await login({ email: 'e', password: 'p', mfaSecret: 'JBSWY3DPEHPK3PXP', deviceUuid: 'dev', fetchImpl });
  assert.deepEqual(out, { token: 'abc', userId: '42' });
  const s = seen[0]!;
  assert.equal(s.url, 'https://api.monarch.com/auth/login/');
  assert.equal(s.body.username, 'e');
  assert.equal(s.body.trusted_device, true);
  assert.equal(s.body.supports_mfa, true);
  assert.equal(s.body.supports_email_otp, true);
  assert.equal(s.body.supports_recaptcha, true);
  assert.match(String(s.body.totp), /^\d{6}$/);
  assert.equal(s.headers['Device-UUID'], 'dev');
  assert.match(s.headers['User-Agent']!, /Mozilla/);
});

test('email OTP is forwarded when given', async () => {
  const { fetchImpl, seen } = capture(200, { id: '1', token: 't' });
  await login({ email: 'e', password: 'p', deviceUuid: 'dev', emailOtp: '123456', fetchImpl });
  assert.equal(seen[0]!.body.email_otp, '123456');
  assert.equal('totp' in seen[0]!.body, false);
});

for (const code of ['EMAIL_OTP_REQUIRED', 'CAPTCHA_REQUIRED', 'MFA_REQUIRED']) {
  test(`${code} surfaces as MonarchError.code`, async () => {
    const { fetchImpl } = capture(403, { detail: 'nope', error_code: code });
    await assert.rejects(
      login({ email: 'e', password: 'p', deviceUuid: 'dev', fetchImpl }),
      (e: unknown) => e instanceof MonarchError && e.code === code,
    );
  });
}

test('a 200 without a token is a login failure', async () => {
  const { fetchImpl } = capture(200, { id: '1' });
  await assert.rejects(login({ email: 'e', password: 'p', deviceUuid: 'dev', fetchImpl }), /LOGIN_FAILED/);
});
