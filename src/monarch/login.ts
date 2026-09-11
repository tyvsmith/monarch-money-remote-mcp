// POST /auth/login/ the way the web app does it. Monarch answers with an
// error_code when it needs another factor; callers resubmit with that factor:
//   MFA_REQUIRED        -> totp (generated here from mfaSecret)
//   EMAIL_OTP_REQUIRED  -> emailOtp (code Monarch emailed; new devices only)
//   CAPTCHA_REQUIRED    -> captcha_token (reCAPTCHA; browser only, we cannot)
// A successful login with trusted_device marks deviceUuid trusted, so later
// logins from the same UUID skip the email OTP.
import { TOTP } from 'otpauth';
import { DEFAULT_BASE_URL, MONARCH_HEADERS, MonarchError, readJson } from './client.ts';

export interface LoginInput {
  email: string;
  password: string;
  mfaSecret?: string;
  emailOtp?: string;
  deviceUuid: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface LoginResponse {
  id?: string | number;
  token?: string;
  detail?: string;
  error_code?: string;
}

export function totpCode(secret: string): string {
  return new TOTP({ secret: secret.replace(/\s+/g, '').toUpperCase(), digits: 6, period: 30 }).generate();
}

export async function login(input: LoginInput): Promise<{ token: string; userId: string }> {
  const base = (input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const fetchImpl = input.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    username: input.email,
    password: input.password,
    trusted_device: true,
    supports_mfa: true,
    supports_email_otp: true,
    supports_recaptcha: true,
  };
  if (input.emailOtp) body.email_otp = input.emailOtp;
  else if (input.mfaSecret) body.totp = totpCode(input.mfaSecret);

  const res = await fetchImpl(`${base}/auth/login/`, {
    method: 'POST',
    headers: { ...MONARCH_HEADERS, 'Content-Type': 'application/json', 'Device-UUID': input.deviceUuid },
    body: JSON.stringify(body),
  });
  const data = (await readJson(res)) as LoginResponse;
  if (!res.ok || !data.token) {
    const code = data.error_code ?? (res.status === 429 ? 'RATE_LIMIT' : 'LOGIN_FAILED');
    throw new MonarchError(
      `Monarch login failed (${res.status} ${code}): ${data.detail ?? ''}`.trim(),
      res.status || 502,
      code,
      data,
    );
  }
  return { token: data.token, userId: String(data.id ?? '') };
}
