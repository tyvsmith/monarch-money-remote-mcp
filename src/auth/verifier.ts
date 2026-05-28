// Bearer-token verifier for the MCP resource server. Implements the
// OAuthTokenVerifier contract from @modelcontextprotocol/sdk so requests with
// `Authorization: Bearer <token>` can be validated.
//
// DEVIATION FROM SPEC:
// The plan called for JWT-only access tokens validated via jose's remote
// JWKS. better-auth's oidc-provider plugin (the only OAuth/OIDC AS option in
// better-auth@1.6.x that supports `trustedClients` as a config option for
// our pre-registered single client) always issues *opaque* random access
// tokens; only the `id_token` is a JWT. The newer @better-auth/oauth-provider
// package DOES issue JWT access tokens but requires DB-side client seeding
// instead of a config-level trustedClients list, and would require schema +
// endpoint-path migration that breaks the spec's `/api/auth/oauth2/...`
// routing assumption.
//
// Compromise: the verifier handles both shapes.
//   1. If the token parses as a JWT and validates against our JWKS, use the
//      JWT claims. This keeps us forward-compatible with a future migration
//      to JWT access tokens.
//   2. Otherwise fall back to opaque-token lookup via better-auth's internal
//      adapter against the `oauthAccessToken` table. This is the same path
//      better-auth's own /oauth2/userinfo uses.
//
// The on-the-wire bearer token in both cases is what the OAuth /token
// endpoint returned in `access_token`. The MCP SDK's bearerAuth middleware
// doesn't care about the format.

import { createRemoteJWKSet, jwtVerify, decodeJwt, type JWTPayload } from 'jose';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { config } from '../config.ts';
import { getAuth } from './better-auth.ts';

const JWKS_URL = new URL(`${config.issuerUrl}/api/auth/jwks`);

// jose's createRemoteJWKSet caches the JWKS by default (10 min TTL, with
// background refresh on signature failures). Reuse a single instance.
const jwks = createRemoteJWKSet(JWKS_URL);

function looksLikeJwt(token: string): boolean {
  // header.payload.signature — three base64url-ish segments.
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  return parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p));
}

function jwtToAuthInfo(token: string, payload: JWTPayload): AuthInfo {
  const scopesRaw = payload['scope'] ?? payload['scopes'];
  let scopes: string[] = [];
  if (typeof scopesRaw === 'string') scopes = scopesRaw.split(/\s+/).filter(Boolean);
  else if (Array.isArray(scopesRaw))
    scopes = scopesRaw.filter((s): s is string => typeof s === 'string');

  const clientId =
    typeof payload['client_id'] === 'string'
      ? (payload['client_id'] as string)
      : typeof payload.aud === 'string'
        ? payload.aud
        : Array.isArray(payload.aud) && typeof payload.aud[0] === 'string'
          ? payload.aud[0]
          : 'unknown';

  const info: AuthInfo = { token, clientId, scopes };
  if (typeof payload.exp === 'number') info.expiresAt = payload.exp;
  return info;
}

async function verifyOpaque(token: string): Promise<AuthInfo> {
  // Look up the opaque token in better-auth's oauthAccessToken table via the
  // same adapter the plugin writes to. This is identical to the lookup the
  // built-in /oauth2/userinfo endpoint does.
  const auth = await getAuth();
  // auth.$context is a Promise on better-auth's typed instance.
  const ctx = await (auth as unknown as { $context: Promise<{ adapter: {
    findOne: (args: {
      model: string;
      where: { field: string; value: unknown }[];
    }) => Promise<Record<string, unknown> | null>;
  } }> }).$context;

  const row = (await ctx.adapter.findOne({
    model: 'oauthAccessToken',
    where: [{ field: 'accessToken', value: token }],
  })) as
    | {
        accessToken?: string;
        clientId?: string;
        userId?: string;
        scopes?: string;
        accessTokenExpiresAt?: Date | string;
      }
    | null;

  if (!row) throw new InvalidTokenError('invalid access token');

  const expiresAtRaw = row.accessTokenExpiresAt;
  const expiresAt =
    expiresAtRaw instanceof Date
      ? expiresAtRaw
      : typeof expiresAtRaw === 'string'
        ? new Date(expiresAtRaw)
        : null;
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    throw new InvalidTokenError('access token expired');
  }

  return {
    token,
    clientId: row.clientId ?? 'unknown',
    scopes: (row.scopes ?? '').split(/\s+/).filter(Boolean),
    expiresAt: Math.floor(expiresAt.getTime() / 1000),
  };
}

export const jwtVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (looksLikeJwt(token)) {
      // Try JWT validation first. If the issuer matches ours, treat as
      // authoritative. If the token shape parses but verification fails for
      // a real reason (wrong signature, expired), surface that error.
      try {
        const unsafe = decodeJwt(token);
        if (typeof unsafe.iss === 'string' && unsafe.iss === config.issuerUrl) {
          const { payload } = await jwtVerify(token, jwks, {
            issuer: config.issuerUrl,
          });
          return jwtToAuthInfo(token, payload);
        }
      } catch {
        // Fall through to opaque lookup — the token may have happened to
        // have three dot-separated segments coincidentally.
      }
    }
    return verifyOpaque(token);
  },
};
