#!/usr/bin/env node
// Deploy monarch-money-remote-mcp to Cloud Run + manage the OAuth trusted-client list.
//
// Usage:
//   node scripts/deploy.ts                          # build + deploy (assumes bootstrap done)
//   node scripts/deploy.ts --bootstrap              # first-time setup: enable APIs, create SA, push secrets, deploy
//   node scripts/deploy.ts --rotate-secrets         # push current .env secrets as new versions, then deploy
//   node scripts/deploy.ts --new-client <name>      # generate + register a new OAuth trusted client
//                                                   #   optional: --redirects=url1,url2,...
//   node scripts/deploy.ts --list-clients           # list registered OAuth clients (secret masked)
//   node scripts/deploy.ts --remove-client <name>   # drop a client from the list
//
// Reads .env for both deploy config (GCP_PROJECT_ID, GCP_REGION, GCP_SERVICE)
// and (on --bootstrap or --rotate-secrets) the runtime secrets.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { argv } from 'node:process';

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = loadEnvFile('.env');
function lookup(key: string): string | undefined {
  return process.env[key] ?? fileEnv[key];
}
function required(key: string): string {
  const v = lookup(key);
  if (!v) {
    console.error(`Missing ${key} (set in .env or env)`);
    process.exit(1);
  }
  return v;
}

// ---- arg parsing -----------------------------------------------------------

const rawArgs = argv.slice(2);
const flagSet = new Set<string>();
const flagValues = new Map<string, string>();
const positionals: string[] = [];

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (!a) continue;
  if (a.startsWith('--')) {
    // Support both `--flag=value` and `--flag value`.
    const eq = a.indexOf('=');
    if (eq !== -1) {
      const k = a.slice(0, eq);
      flagSet.add(k);
      flagValues.set(k, a.slice(eq + 1));
    } else {
      flagSet.add(a);
      // For known value-taking flags, consume next token unless it's a flag.
      if (
        (a === '--new-client' || a === '--remove-client' || a === '--redirects') &&
        i + 1 < rawArgs.length &&
        !rawArgs[i + 1]!.startsWith('--')
      ) {
        flagValues.set(a, rawArgs[i + 1]!);
        i++;
      }
    }
  } else {
    positionals.push(a);
  }
}

const doBootstrap = flagSet.has('--bootstrap');
const doRotateSecrets = flagSet.has('--rotate-secrets');
const doNewClient = flagSet.has('--new-client');
const doListClients = flagSet.has('--list-clients');
const doRemoveClient = flagSet.has('--remove-client');

const PROJECT_ID = required('GCP_PROJECT_ID');
const REGION = lookup('GCP_REGION') ?? 'us-west1';
const SERVICE = lookup('GCP_SERVICE') ?? 'monarch-bridge';
const RUN_SA_NAME = `${SERVICE}-run`;
const RUN_SA = `${RUN_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com`;

// Map of well-known OAuth client names to their published redirect URIs.
// Used by --new-client when --redirects is omitted.
//
// Note: ChatGPT is NOT listed because its callback URL is per-app and
// unguessable (e.g. https://chatgpt.com/connector/oauth/<unique-id>). When
// registering a ChatGPT connector, pass --redirects=<url-shown-in-New-App-UI>
// explicitly.
const KNOWN_REDIRECTS: Record<string, string[]> = {
  claude: [
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
  ],
};

// ---- shell helpers ---------------------------------------------------------

type RunResult = { ok: boolean; stdout: string; stderr: string };

function runQuiet(cmd: string, args: string[]): RunResult {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function runOrDie(cmd: string, args: string[], opts: { stdin?: string } = {}): void {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    stdio: [opts.stdin === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
    input: opts.stdin,
  });
  if (r.status !== 0) {
    console.error(`command failed: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

function secretExists(name: string): boolean {
  return runQuiet('gcloud', [
    'secrets',
    'describe',
    name,
    `--project=${PROJECT_ID}`,
  ]).ok;
}

function putSecret(name: string, value: string): void {
  if (secretExists(name)) {
    console.log(`secret ${name} exists — adding new version`);
    runOrDie(
      'gcloud',
      ['secrets', 'versions', 'add', name, `--project=${PROJECT_ID}`, '--data-file=-'],
      { stdin: value },
    );
  } else {
    console.log(`creating secret ${name}`);
    runOrDie(
      'gcloud',
      ['secrets', 'create', name, `--project=${PROJECT_ID}`, '--data-file=-'],
      { stdin: value },
    );
  }
}

function bindSecretRole(name: string, role: string): void {
  runOrDie('gcloud', [
    'secrets',
    'add-iam-policy-binding',
    name,
    `--project=${PROJECT_ID}`,
    `--member=serviceAccount:${RUN_SA}`,
    `--role=${role}`,
    '--condition=None',
  ]);
}

function ensureSessionSecretContainer(): void {
  if (secretExists('monarch-session')) {
    console.log('secret monarch-session exists — skipping create');
    return;
  }
  // Create empty secret container — the running service adds the first version
  // after its first successful login.
  console.log('creating empty secret monarch-session');
  runOrDie('gcloud', [
    'secrets',
    'create',
    'monarch-session',
    `--project=${PROJECT_ID}`,
    '--replication-policy=automatic',
  ]);
}

function ensureOAuthStateSecretContainer(): void {
  if (secretExists('oauth-state')) {
    console.log('secret oauth-state exists — skipping create');
    return;
  }
  // Empty container — better-auth's adapter (src/auth/secret-manager-adapter.ts)
  // adds the first version after the first OAuth state mutation.
  console.log('creating empty secret oauth-state');
  runOrDie('gcloud', [
    'secrets',
    'create',
    'oauth-state',
    `--project=${PROJECT_ID}`,
    '--replication-policy=automatic',
  ]);
}

function ensureOAuthClientsSecretContainer(): void {
  if (secretExists('oauth-clients')) {
    console.log('secret oauth-clients exists — skipping create');
    return;
  }
  // Empty container — `--new-client` / migration adds the first version with
  // a JSON-array payload.
  console.log('creating empty secret oauth-clients');
  runOrDie('gcloud', [
    'secrets',
    'create',
    'oauth-clients',
    `--project=${PROJECT_ID}`,
    '--replication-policy=automatic',
  ]);
}

function randomHex(bytes: number): string {
  const r = spawnSync('openssl', ['rand', '-hex', String(bytes)], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('openssl rand failed');
    process.exit(r.status ?? 1);
  }
  return (r.stdout ?? '').trim();
}

function ensureAuthUserEmailSecret(): void {
  if (secretExists('auth-user-email')) {
    console.log('secret auth-user-email exists — skipping create');
    return;
  }
  // Pick a stable synthetic email for the single end-user identity. Operators
  // can later rotate via `gcloud secrets versions add` if they want to.
  const email = `user@${SERVICE}.local`;
  putSecret('auth-user-email', email);
}

// ---- oauth-clients list operations ----------------------------------------

interface OAuthClient {
  name: string;
  clientId: string;
  clientSecret: string;
  redirects: string[];
  skipConsent: boolean;
}

// Hard cap version count so the secret doesn't accumulate unbounded history
// (Secret Manager bills per active version). Matches the cap used in
// src/auth/secret-manager-adapter.ts for consistency.
const MAX_OAUTH_CLIENTS_VERSIONS_TO_KEEP = 5;

function readOAuthClientsBlob(): OAuthClient[] {
  if (!secretExists('oauth-clients')) return [];
  const r = runQuiet('gcloud', [
    'secrets',
    'versions',
    'access',
    'latest',
    '--secret=oauth-clients',
    `--project=${PROJECT_ID}`,
  ]);
  if (!r.ok) {
    // The container may exist with zero versions (just-bootstrapped) — gcloud
    // returns non-zero. Treat as empty.
    return [];
  }
  const text = (r.stdout ?? '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      console.error('oauth-clients secret payload is not a JSON array — aborting');
      process.exit(1);
    }
    return parsed as OAuthClient[];
  } catch (err) {
    console.error('failed to parse oauth-clients JSON:', err);
    process.exit(1);
  }
}

function writeOAuthClientsBlob(clients: OAuthClient[]): void {
  const payload = JSON.stringify(clients);
  putSecret('oauth-clients', payload);
  pruneOAuthClientsVersions();
}

function pruneOAuthClientsVersions(): void {
  // List enabled versions newest-first, then destroy anything past the cap.
  // gcloud's --filter syntax handles state filtering server-side.
  const r = runQuiet('gcloud', [
    'secrets',
    'versions',
    'list',
    'oauth-clients',
    `--project=${PROJECT_ID}`,
    '--filter=state=ENABLED',
    '--sort-by=~createTime',
    '--format=value(name)',
  ]);
  if (!r.ok) return;
  const names = (r.stdout ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length <= MAX_OAUTH_CLIENTS_VERSIONS_TO_KEEP) return;
  const toDestroy = names.slice(MAX_OAUTH_CLIENTS_VERSIONS_TO_KEEP);
  for (const n of toDestroy) {
    const dr = runQuiet('gcloud', [
      'secrets',
      'versions',
      'destroy',
      n,
      '--secret=oauth-clients',
      `--project=${PROJECT_ID}`,
      '--quiet',
    ]);
    if (!dr.ok) {
      console.warn(`failed to destroy old version ${n}: ${dr.stderr.trim()}`);
    }
  }
}

// Force a new Cloud Run revision so the runtime re-reads `oauth-clients` on
// boot. Without this, claude.ai can't authorize against a freshly-added
// client until the next deploy. We bump a benign env var (nothing reads
// OAUTH_CLIENTS_REV at runtime) — `gcloud run services update` with
// --update-env-vars triggers a new revision atomically.
function forceNewRevision(): void {
  if (!runQuiet('gcloud', [
    'run',
    'services',
    'describe',
    SERVICE,
    `--region=${REGION}`,
    `--project=${PROJECT_ID}`,
  ]).ok) {
    console.log(`(service ${SERVICE} not deployed yet — skipping revision bump)`);
    return;
  }
  console.log(`bumping Cloud Run revision so oauth-clients is re-read…`);
  runOrDie('gcloud', [
    'run',
    'services',
    'update',
    SERVICE,
    `--region=${REGION}`,
    `--project=${PROJECT_ID}`,
    `--update-env-vars=OAUTH_CLIENTS_REV=${Date.now()}`,
  ]);
}

// ---- CLI commands ---------------------------------------------------------

function newClient(): void {
  const name = flagValues.get('--new-client') ?? positionals[0];
  if (!name) {
    console.error('usage: --new-client <name> [--redirects=url1,url2,...]');
    process.exit(1);
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    console.error(`invalid client name "${name}" — must match /^[a-z0-9-]+$/`);
    process.exit(1);
  }

  // Determine redirects.
  const redirectsFlag = flagValues.get('--redirects');
  let redirects: string[];
  if (redirectsFlag) {
    redirects = redirectsFlag.split(',').map((s) => s.trim()).filter(Boolean);
    if (redirects.length === 0) {
      console.error('--redirects given but no URLs parsed');
      process.exit(1);
    }
  } else if (KNOWN_REDIRECTS[name]) {
    redirects = KNOWN_REDIRECTS[name];
  } else {
    console.error(
      `unknown client "${name}" — pass --redirects=url1,url2,... (known: ${Object.keys(KNOWN_REDIRECTS).join(', ')})`,
    );
    process.exit(1);
  }

  ensureOAuthClientsSecretContainer();
  const clients = readOAuthClientsBlob();
  if (clients.some((c) => c.name === name)) {
    console.error(`client "${name}" already exists — run --remove-client ${name} first`);
    process.exit(1);
  }

  const entry: OAuthClient = {
    name,
    clientId: randomHex(16),
    clientSecret: randomHex(32),
    redirects,
    skipConsent: true,
  };
  clients.push(entry);
  writeOAuthClientsBlob(clients);

  // Grant the runtime SA access if not already (idempotent).
  bindSecretRole('oauth-clients', 'roles/secretmanager.secretAccessor');

  forceNewRevision();

  console.log('\n=== OAuth client credentials (paste into the connector UI) ===');
  console.log(`  name          = ${entry.name}`);
  console.log(`  CLIENT_ID     = ${entry.clientId}`);
  console.log(`  CLIENT_SECRET = ${entry.clientSecret}`);
  console.log(`  redirects     = ${entry.redirects.join(', ')}`);
  console.log(`\nPaste CLIENT_ID and CLIENT_SECRET into the connector's Advanced settings.`);
  console.log(`Inspect later with: npm run deploy:list-clients\n`);
}

function listClients(): void {
  const clients = readOAuthClientsBlob();
  if (clients.length === 0) {
    console.log('(no OAuth clients registered)');
    return;
  }
  // Plain text table — keep simple; secret column always masked.
  const rows = clients.map((c) => ({
    name: c.name,
    clientId: c.clientId,
    clientSecret: '****',
    redirects: c.redirects.join(' '),
  }));
  const widths = {
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    clientId: Math.max(8, ...rows.map((r) => r.clientId.length)),
    clientSecret: 4,
    redirects: Math.max(9, ...rows.map((r) => r.redirects.length)),
  };
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
  console.log(
    `${pad('NAME', widths.name)}  ${pad('CLIENT_ID', widths.clientId)}  ${pad('SECRET', widths.clientSecret)}  REDIRECTS`,
  );
  for (const r of rows) {
    console.log(
      `${pad(r.name, widths.name)}  ${pad(r.clientId, widths.clientId)}  ${pad(r.clientSecret, widths.clientSecret)}  ${r.redirects}`,
    );
  }
}

function removeClient(): void {
  const name = flagValues.get('--remove-client') ?? positionals[0];
  if (!name) {
    console.error('usage: --remove-client <name>');
    process.exit(1);
  }
  const clients = readOAuthClientsBlob();
  const next = clients.filter((c) => c.name !== name);
  if (next.length === clients.length) {
    // Silent exit-0 per spec; the caller's intent (be gone) is satisfied.
    return;
  }
  writeOAuthClientsBlob(next);
  forceNewRevision();
  console.log(`removed OAuth client "${name}"`);
}

// ---- bootstrap migration --------------------------------------------------

// On --bootstrap, if legacy oauth-client-id / oauth-client-secret secrets
// exist AND oauth-clients is empty, synthesise a one-entry list keyed on the
// "claude" client and write it as the first version. The legacy secrets are
// NOT deleted here — operators verify the migration, then clean up manually
// via `gcloud secrets delete`. Documented in README.md.
function maybeMigrateLegacyOAuthClient(): void {
  const clients = readOAuthClientsBlob();
  if (clients.length > 0) return; // already migrated or non-empty.

  const hasLegacyId = secretExists('oauth-client-id');
  const hasLegacySecret = secretExists('oauth-client-secret');
  if (!hasLegacyId || !hasLegacySecret) return;

  console.log('=== migrating legacy oauth-client-id/oauth-client-secret into oauth-clients ===');
  const idR = runQuiet('gcloud', [
    'secrets',
    'versions',
    'access',
    'latest',
    '--secret=oauth-client-id',
    `--project=${PROJECT_ID}`,
  ]);
  const secR = runQuiet('gcloud', [
    'secrets',
    'versions',
    'access',
    'latest',
    '--secret=oauth-client-secret',
    `--project=${PROJECT_ID}`,
  ]);
  if (!idR.ok || !secR.ok) {
    console.warn('legacy secret reads failed — skipping migration. Re-run after manually fixing access.');
    return;
  }
  const entry: OAuthClient = {
    name: 'claude',
    clientId: idR.stdout.trim(),
    clientSecret: secR.stdout.trim(),
    redirects: KNOWN_REDIRECTS.claude!,
    skipConsent: true,
  };
  writeOAuthClientsBlob([entry]);
  console.log(
    `migrated legacy OAuth client into oauth-clients as "claude". You can run\n` +
    `  gcloud secrets delete oauth-client-id     --project=${PROJECT_ID}\n` +
    `  gcloud secrets delete oauth-client-secret --project=${PROJECT_ID}\n` +
    `once you've verified the connector still works.`,
  );
}

function bootstrap(): void {
  console.log('=== bootstrap: enabling required APIs ===');
  runOrDie('gcloud', [
    'services',
    'enable',
    'run.googleapis.com',
    'cloudbuild.googleapis.com',
    'artifactregistry.googleapis.com',
    'secretmanager.googleapis.com',
    'iam.googleapis.com',
    `--project=${PROJECT_ID}`,
  ]);

  console.log('=== bootstrap: service account ===');
  if (
    !runQuiet('gcloud', [
      'iam',
      'service-accounts',
      'describe',
      RUN_SA,
      `--project=${PROJECT_ID}`,
    ]).ok
  ) {
    runOrDie('gcloud', [
      'iam',
      'service-accounts',
      'create',
      RUN_SA_NAME,
      `--project=${PROJECT_ID}`,
      `--display-name=${SERVICE} Cloud Run service account`,
    ]);
  } else {
    console.log(`service account ${RUN_SA} exists — skipping create`);
  }

  pushAllSecrets();
  ensureSessionSecretContainer();
  ensureOAuthStateSecretContainer();
  ensureOAuthClientsSecretContainer();
  ensureAuthUserEmailSecret();

  // Migrate from the legacy two-secret model if present. Idempotent: no-op
  // if oauth-clients already has entries.
  maybeMigrateLegacyOAuthClient();

  console.log('=== bootstrap: granting SA secretAccessor on each secret ===');
  for (const s of [
    'monarch-email',
    'monarch-password',
    'monarch-mfa',
    'monarch-device-uuid',
    'wrapper-api-key',
    'monarch-session',
    'oauth-state',
    'oauth-clients',
    'auth-user-email',
  ]) {
    bindSecretRole(s, 'roles/secretmanager.secretAccessor');
  }

  console.log('=== bootstrap: granting SA secretVersionAdder on session + oauth-state ===');
  // The session secret and the OAuth state secret both need write access —
  // the runtime appends new versions after auth mutations so cold starts can
  // resume. The oauth-clients secret is written by this script only (CLI),
  // not by the runtime, so it doesn't need secretVersionAdder on the SA.
  bindSecretRole('monarch-session', 'roles/secretmanager.secretVersionAdder');
  bindSecretRole('oauth-state', 'roles/secretmanager.secretVersionAdder');

  console.log('\n=== bootstrap complete ===');
  console.log('Manage OAuth clients with:');
  console.log('  npm run deploy:list-clients');
  console.log('  npm run deploy:new-client    -- <name> [--redirects=url1,url2,...]');
  console.log('  npm run deploy:remove-client -- <name>\n');
}

function pushAllSecrets(): void {
  console.log('=== pushing secrets from .env ===');
  putSecret('monarch-email', required('MONARCH_EMAIL'));
  putSecret('monarch-password', required('MONARCH_PASSWORD'));
  putSecret('monarch-mfa', required('MONARCH_MFA_SECRET'));
  putSecret('monarch-device-uuid', required('MONARCH_DEVICE_UUID'));
  putSecret('wrapper-api-key', required('WRAPPER_API_KEY'));
  pushEnrolledSession();
}

// `npm run monarch:enroll` logs in from a laptop (where Monarch's CAPTCHA and
// new-device checks are least likely to fire) and writes the token + trusted
// device UUID to a local file. Pushing that file as the monarch-session secret
// lets Cloud Run resume the enrolled session instead of logging in itself.
function pushEnrolledSession(): void {
  const file = lookup('MONARCH_SESSION_FILE') ?? '.monarch-session.json';
  if (!existsSync(file)) {
    console.log(`no ${file}; Cloud Run will log in on first request (run npm run monarch:enroll to avoid that)`);
    return;
  }
  const raw = readFileSync(file, 'utf8').trim();
  const parsed = JSON.parse(raw) as { token?: string; deviceUuid?: string };
  if (!parsed.token || !parsed.deviceUuid) {
    console.error(`${file} must contain {token, deviceUuid}`);
    process.exit(1);
  }
  if (parsed.deviceUuid !== required('MONARCH_DEVICE_UUID')) {
    console.error(`${file} deviceUuid does not match MONARCH_DEVICE_UUID in .env; re-run npm run monarch:enroll`);
    process.exit(1);
  }
  ensureSessionSecretContainer();
  putSecret('monarch-session', raw);
}

function deploy(): void {
  console.log('=== deploying to Cloud Run ===');
  // Two-stage deploy: first push to provision the service URL (if new), then
  // re-deploy with ISSUER_URL set to that URL so better-auth signs JWTs with
  // the correct `iss` claim. On subsequent deploys we read the existing URL
  // up front and pass it on the first call.
  const existingUrl = runQuiet('gcloud', [
    'run',
    'services',
    'describe',
    SERVICE,
    `--region=${REGION}`,
    `--project=${PROJECT_ID}`,
    '--format=value(status.url)',
  ]);
  const explicitIssuer = (existingUrl.stdout ?? '').trim();

  const envVars: string[] = [`GCP_PROJECT_ID=${PROJECT_ID}`, `MONARCH_ENABLE_WRITES=${lookup('MONARCH_ENABLE_WRITES') === '1' ? '1' : '0'}`];
  if (explicitIssuer) envVars.push(`ISSUER_URL=${explicitIssuer}`);

  // OAuth client credentials are NOT mounted as env vars anymore — the
  // runtime reads them from the `oauth-clients` Secret Manager blob directly
  // (src/auth/oauth-clients.ts).
  const secrets = [
    'MONARCH_EMAIL=monarch-email:latest',
    'MONARCH_PASSWORD=monarch-password:latest',
    'MONARCH_MFA_SECRET=monarch-mfa:latest',
    'MONARCH_DEVICE_UUID=monarch-device-uuid:latest',
    'WRAPPER_API_KEY=wrapper-api-key:latest',
    'AUTH_USER_EMAIL=auth-user-email:latest',
  ].join(',');

  runOrDie('gcloud', [
    'run',
    'deploy',
    SERVICE,
    '--source=.',
    `--region=${REGION}`,
    `--project=${PROJECT_ID}`,
    '--allow-unauthenticated',
    `--service-account=${RUN_SA}`,
    `--set-env-vars=${envVars.join(',')}`,
    `--set-secrets=${secrets}`,
  ]);

  const urlResult = runQuiet('gcloud', [
    'run',
    'services',
    'describe',
    SERVICE,
    `--region=${REGION}`,
    `--project=${PROJECT_ID}`,
    '--format=value(status.url)',
  ]);
  const finalUrl = urlResult.stdout.trim();
  console.log(`\n✓ deployed: ${finalUrl}`);

  // If this was a first-time deploy, the URL only existed AFTER the deploy
  // call, so ISSUER_URL was unset. Redeploy with the correct value so JWT
  // issuance is consistent.
  if (!explicitIssuer && finalUrl) {
    console.log('\n=== first deploy detected — re-deploying with ISSUER_URL set ===');
    runOrDie('gcloud', [
      'run',
      'services',
      'update',
      SERVICE,
      `--region=${REGION}`,
      `--project=${PROJECT_ID}`,
      `--set-env-vars=GCP_PROJECT_ID=${PROJECT_ID},ISSUER_URL=${finalUrl}`,
    ]);
    console.log(`✓ ISSUER_URL set to ${finalUrl}`);
  }
}

// ---- dispatch -------------------------------------------------------------

// Client-management commands stand alone — they should NOT re-deploy after
// running (forceNewRevision() already bumped Cloud Run). Bootstrap and
// rotate-secrets continue to chain into deploy().
if (doListClients) {
  listClients();
  process.exit(0);
}
if (doNewClient) {
  newClient();
  process.exit(0);
}
if (doRemoveClient) {
  removeClient();
  process.exit(0);
}

if (doBootstrap) {
  bootstrap();
} else if (doRotateSecrets) {
  pushAllSecrets();
}

deploy();
