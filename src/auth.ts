// Dual-mode auth middleware:
//   1. If the request carries the static WRAPPER_API_KEY on `X-API-Key` or
//      `Authorization: Bearer …`, short-circuit (backwards compat for Custom
//      GPT Actions and the existing Claude config).
//   2. Otherwise delegate to OAuth 2.1 bearer-token validation via the JWT
//      verifier that points at our own JWKS.
//
// On final 401 we set a WWW-Authenticate header per RFC 6750 + RFC 9728 so
// claude.ai's Custom Connector UI can discover the auth server.

import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { jwtVerifier } from './auth/verifier.ts';
import { config } from './config.ts';

const RESOURCE_METADATA_URL = `${config.issuerUrl}/.well-known/oauth-protected-resource`;

function staticKeyMatches(expectedBuf: Buffer, presented: string): boolean {
  if (!presented) return false;
  const presentedBuf = Buffer.from(presented);
  if (presentedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(presentedBuf, expectedBuf);
}

export function apiKeyAuth(expected: string): RequestHandler {
  const expectedBuf = Buffer.from(expected);
  const bearerMw = requireBearerAuth({
    verifier: jwtVerifier,
    resourceMetadataUrl: RESOURCE_METADATA_URL,
  });

  return (req, res, next) => {
    const fromHeader = req.header('x-api-key');
    const fromAuth = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    const presented = fromHeader ?? fromAuth ?? '';

    if (staticKeyMatches(expectedBuf, presented)) {
      next();
      return;
    }

    // Delegate to bearer-token validation. requireBearerAuth itself sets the
    // WWW-Authenticate header on its 401 responses when resourceMetadataUrl
    // is provided, so claude.ai can follow the metadata link.
    bearerMw(req, res, next);
  };
}
