// Better-auth instance: configures the OAuth 2.1 authorization server that
// claude.ai's Custom Connector UI talks to.
//
// Plugin stack:
//   * jwt        — issues ES256 JWT access tokens with a JWKS endpoint
//   * oidcProvider — the actual OAuth/OIDC AS. We bypass DCR via
//                    trustedClients + skipConsent.
//
// Note we deliberately do NOT enable better-auth's separate `mcp` plugin —
// it conflicts with oidcProvider on /oauth2/consent and only duplicates
// metadata that we already serve via @modelcontextprotocol/sdk's
// mcpAuthMetadataRouter in src/auth/router.ts.
//
// Identity: a single end-user (config.authUserEmail / config.wrapperApiKey).
// On boot we seed the user row if missing — better-auth's emailAndPassword
// provider then handles login + consent + token issuance.
//
// IMPORTANT: rotating the JWT signing keys (stored in the JWKS table) will
// invalidate every outstanding access token. Acceptable for a single-user
// service; document for the operator.

import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { jwt } from 'better-auth/plugins/jwt';
import { oidcProvider } from 'better-auth/plugins';
import { config } from '../config.ts';
import { createSecretManagerAdapter } from './secret-manager-adapter.ts';
import { loadTrustedClients } from './oauth-clients.ts';

export type AuthInstance = ReturnType<typeof betterAuth>;

async function seedDefaultUser(auth: AuthInstance): Promise<void> {
  if (!config.authUserEmail || !config.wrapperApiKey) return;
  try {
    await auth.api.signUpEmail({
      body: {
        email: config.authUserEmail,
        password: config.wrapperApiKey,
        name: 'monarch-money-remote-mcp user',
      },
    });
    console.log('[better-auth] seeded default user', config.authUserEmail);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // The signUp call is idempotent: the existing user row is fine and we
    // treat "already exists" as success. Anything else surfaces but doesn't
    // block boot — the existing row from a prior cold start is still usable.
    if (/exist/i.test(msg) || /unique/i.test(msg) || /USER_ALREADY_EXISTS/i.test(msg)) {
      return;
    }
    console.warn('[better-auth] could not seed default user:', err);
  }
}

let cached: AuthInstance | null = null;
let pending: Promise<AuthInstance> | null = null;

export function getAuth(): Promise<AuthInstance> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = (async () => {
    const { adapter } = await createSecretManagerAdapter();

    // Trusted clients live in the `oauth-clients` Secret Manager secret
    // (managed via scripts/deploy.ts --new-client / --list-clients /
    // --remove-client). The plugin still validates each authorize call's
    // redirect_uri against the configured list.
    const loaded = await loadTrustedClients();
    const trustedClients = loaded.length > 0 ? loaded : undefined;

    const options: BetterAuthOptions = {
      appName: 'monarch-money-remote-mcp',
      baseURL: config.issuerUrl,
      basePath: '/api/auth',
      // betterAuth requires a secret for cookie/state encryption. We reuse
      // the wrapper API key — it's already a strong random secret and is
      // already mounted, avoiding yet another managed value.
      secret: config.wrapperApiKey,
      database: adapter,
      emailAndPassword: {
        enabled: true,
        // We can't use better-auth's `disableSignUp` here — it gates the
        // in-process auth.api.signUpEmail() call too, which we need to seed
        // the single user. The public POST /api/auth/sign-up/* route is
        // instead blocked at the Express layer in src/auth/router.ts.
      },
      plugins: [
        jwt({
          jwks: {
            keyPairConfig: { alg: 'ES256' },
          },
          jwt: {
            issuer: config.issuerUrl,
            audience: config.issuerUrl,
            expirationTime: '1h',
          },
          // We don't want better-auth setting a `set-auth-jwt` header on
          // every response from the OAuth endpoints — the OAuth token
          // endpoint already returns the JWT in the access_token field.
          disableSettingJwtHeader: true,
        }),
        oidcProvider({
          loginPage: '/oauth/login',
          requirePKCE: true,
          useJWTPlugin: true,
          accessTokenExpiresIn: 3600,
          refreshTokenExpiresIn: 60 * 60 * 24 * 30, // 30 days
          ...(trustedClients ? { trustedClients } : {}),
        }),
      ],
    };

    const auth = betterAuth(options);
    await seedDefaultUser(auth);
    cached = auth;
    pending = null;
    return auth;
  })();
  return pending;
}
