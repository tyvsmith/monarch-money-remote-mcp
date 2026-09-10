// One-time enrollment: log in to Monarch from this machine, get Monarch to
// trust a device UUID, and persist {token, deviceUuid} for the service.
//
//   npm run monarch:enroll                       # login with .env creds, prompt for email code if asked
//   npm run monarch:enroll -- --import ~/.mm/session.json   # reuse a session the old SDK created
//
// Run this from a laptop, not Cloud Run: Monarch's CAPTCHA and new-device
// email OTP fire far less often from a residential IP, and the OTP needs a
// human anyway. Afterwards `npm run deploy:rotate-secrets` pushes the UUID and
// the session to Secret Manager so the service never logs in as a new device.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createClient, MonarchError } from '../src/monarch/client.ts';
import { login } from '../src/monarch/login.ts';
import { saveSession, type SavedSession } from '../src/session-store.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const env = process.env;
const baseUrl = (env.MONARCH_BASE_URL ?? 'https://api.monarch.com').replace(/\/$/, '');
const rl = createInterface({ input: stdin, output: stdout });
const ask = (q: string) => rl.question(q).then((s) => s.trim());

function upsertEnv(key: string, value: string): void {
  const file = '.env';
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(file, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
}

async function verify(s: SavedSession): Promise<{ id: string; email: string }> {
  const c = createClient({ baseUrl, token: async () => s.token, deviceUuid: s.deviceUuid });
  return (await c.query<{ me: { id: string; email: string } }>('query Enroll { me { id email } }')).me;
}

async function enrollByLogin(deviceUuid: string): Promise<SavedSession> {
  const email = env.MONARCH_EMAIL;
  const password = env.MONARCH_PASSWORD;
  if (!email || !password) throw new Error('MONARCH_EMAIL and MONARCH_PASSWORD must be set (in .env or the environment)');
  const mfaSecret = env.MONARCH_MFA_SECRET || undefined;
  const base = { email, password, deviceUuid, baseUrl, mfaSecret };
  let emailOtp: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { token } = await login({ ...base, emailOtp });
      return { token, deviceUuid };
    } catch (err) {
      if (!(err instanceof MonarchError)) throw err;
      switch (err.code) {
        case 'EMAIL_OTP_REQUIRED':
          console.log('Monarch does not know this device yet and emailed you a code.');
          emailOtp = await ask('Email code: ');
          continue;
        case 'MFA_REQUIRED':
          if (mfaSecret) throw new Error('Monarch rejected the TOTP; check MONARCH_MFA_SECRET and this machine\'s clock');
          throw new Error('The account has MFA on but MONARCH_MFA_SECRET is empty. Add the authenticator secret to .env and retry.');
        case 'CAPTCHA_REQUIRED':
          throw new Error(
            'Monarch wants a CAPTCHA for this login, which cannot be answered headlessly. Wait a while, retry from a different network (home Wi-Fi rather than a VPN or cloud host), or import a session from a browser-era SDK file with --import.',
          );
        default:
          throw err;
      }
    }
  }
  throw new Error('login did not succeed after 3 attempts');
}

async function main(): Promise<void> {
  let session: SavedSession;
  const importPath = flag('--import');
  if (importPath) {
    const j = JSON.parse(readFileSync(importPath, 'utf8')) as { token?: string; deviceUuid?: string };
    if (!j.token || !j.deviceUuid) throw new Error(`${importPath} must contain token and deviceUuid`);
    session = { token: j.token, deviceUuid: j.deviceUuid };
    console.log(`importing session for device ${session.deviceUuid} from ${importPath}`);
  } else {
    const deviceUuid = flag('--device-uuid') ?? env.MONARCH_DEVICE_UUID ?? randomUUID();
    console.log(`logging in as device ${deviceUuid}${env.MONARCH_DEVICE_UUID ? ' (from MONARCH_DEVICE_UUID)' : ' (new)'}`);
    session = await enrollByLogin(deviceUuid);
  }

  const me = await verify(session);
  console.log(`session verified for ${me.email} (user ${me.id})`);

  await saveSession(session);
  upsertEnv('MONARCH_DEVICE_UUID', session.deviceUuid);
  console.log('wrote MONARCH_DEVICE_UUID to .env');
  console.log('\nNext: npm run deploy:rotate-secrets   # pushes the UUID and session to Secret Manager, then deploys');
}

try {
  await main();
} catch (err) {
  console.error(`\nenroll failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
