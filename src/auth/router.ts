// Mounts the OAuth 2.1 authorization-server endpoints (better-auth) and the
// resource-server metadata (RFC 9728) under the Express app.
//
// Layout:
//   /api/auth/*                              — better-auth (issues tokens,
//                                              exposes /jwks, /authorize,
//                                              /token, /register, …)
//   /.well-known/oauth-protected-resource    — MCP RS metadata (RFC 9728)
//   /.well-known/oauth-authorization-server  — AS discovery alias that points
//                                              clients at /api/auth/* metadata

import express, { type Router } from 'express';
import rateLimit from 'express-rate-limit';
import { toNodeHandler } from 'better-auth/node';
import { mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { config } from '../config.ts';
import { getAuth } from './better-auth.ts';

// Strict limit for credential-handling endpoints (sign-in, sign-up). 10
// attempts per 15 min per IP — well above any legitimate user, well below
// brute-force throughput. WRAPPER_API_KEY's 256-bit entropy already makes
// brute-force computationally infeasible; this primarily reduces log noise
// and CPU cost if someone tries anyway.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});

// General limit across the rest of /api/auth/*. Token refresh, JWKS lookup,
// authorize redirect — all legitimate and frequent enough to need headroom.
const generalAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});

// The metadata router needs a synchronous OAuthMetadata blob. We construct it
// from the issuer URL — better-auth's endpoints are fixed under
// /api/auth/oauth2/* and /api/auth/jwks.
function buildOAuthMetadata(): OAuthMetadata {
  const base = `${config.issuerUrl}/api/auth`;
  return {
    issuer: config.issuerUrl,
    authorization_endpoint: `${base}/oauth2/authorize`,
    token_endpoint: `${base}/oauth2/token`,
    registration_endpoint: `${base}/oauth2/register`,
    jwks_uri: `${base}/jwks`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function buildAuthRouter(): Promise<Router> {
  const router = express.Router();

  // 1. Resource-server metadata at /.well-known/oauth-protected-resource.
  const metadataRouter = mcpAuthMetadataRouter({
    oauthMetadata: buildOAuthMetadata(),
    resourceServerUrl: new URL(config.issuerUrl),
    scopesSupported: ['openid', 'profile', 'email', 'offline_access'],
    resourceName: 'monarch-money-remote-mcp',
  });
  router.use(metadataRouter);

  // 2. OAuth login page. better-auth's oidcProvider redirects unauthenticated
  //    /api/auth/oauth2/authorize requests here (configured via `loginPage`).
  //    We render a minimal HTML form; on submit we sign the user in via
  //    better-auth's in-process API, forward the resulting Set-Cookie, and
  //    302 back to the original authorize URL so the OAuth flow continues
  //    with a valid session.
  const auth = await getAuth();

  router.get('/oauth/login', (req, res) => {
    const params = new URLSearchParams(req.query as Record<string, string>);
    const callbackURL = `/api/auth/oauth2/authorize?${params.toString()}`;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in — monarch-money-remote-mcp</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 360px; margin: 4rem auto; padding: 0 1rem; color: #222; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p.sub { color: #666; font-size: 0.9rem; margin-top: 0; }
    label { display: block; margin-top: 1rem; font-size: 0.9rem; color: #333; }
    input { display: block; width: 100%; padding: 0.55rem; margin-top: 0.25rem; font-size: 1rem; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; }
    button { width: 100%; padding: 0.65rem; font-size: 1rem; margin-top: 1.25rem; cursor: pointer; background: #1a1a1a; color: white; border: 0; border-radius: 4px; }
    .hint { color: #888; font-size: 0.8rem; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <h1>Sign in to monarch-money-remote-mcp</h1>
  <p class="sub">Approving access for a connected client.</p>
  <form method="POST" action="/oauth/login">
    <input type="hidden" name="callbackURL" value="${escapeHtml(callbackURL)}">
    <label>Email
      <input type="email" name="email" required autofocus autocomplete="username">
    </label>
    <label>Password
      <input type="password" name="password" required autocomplete="current-password">
    </label>
    <button type="submit">Sign in</button>
  </form>
  <p class="hint">Password is your <code>WRAPPER_API_KEY</code>.</p>
</body>
</html>`;
    res.type('html').send(html);
  });

  router.post(
    '/oauth/login',
    credentialLimiter,
    express.urlencoded({ extended: false }),
    async (req, res) => {
      const { email, password, callbackURL } = (req.body ?? {}) as {
        email?: string;
        password?: string;
        callbackURL?: string;
      };
      if (!email || !password || !callbackURL) {
        res.status(400).type('text').send('missing fields');
        return;
      }
      // Whitelist: callbackURL must be our own authorize endpoint. Prevents
      // attacker-crafted form posts that would turn this into an open
      // redirector / cookie-leak vector.
      if (!callbackURL.startsWith('/api/auth/oauth2/authorize?')) {
        res.status(400).type('text').send('invalid callback');
        return;
      }
      try {
        const response = await auth.api.signInEmail({
          body: { email, password },
          asResponse: true,
        });
        // Forward Set-Cookie header(s) from better-auth so the browser stores
        // the session cookie before the redirect.
        const cookies = response.headers.getSetCookie?.() ?? [];
        for (const c of cookies) res.append('Set-Cookie', c);
        if (response.status >= 400) {
          res
            .status(401)
            .type('html')
            .send(
              '<p>Invalid credentials. <a href="javascript:history.back()">Back</a></p>',
            );
          return;
        }
        res.redirect(302, callbackURL);
      } catch (err) {
        console.warn('[oauth-login] sign-in failed:', err);
        res
          .status(401)
          .type('html')
          .send(
            '<p>Invalid credentials. <a href="javascript:history.back()">Back</a></p>',
          );
      }
    },
  );

  // 3. Better-auth handler. toNodeHandler converts the web-fetch-style
  //    auth.handler into an Express-compatible middleware. We mount it as a
  //    bare middleware that self-filters by `req.url` because better-auth's
  //    internal routing compares against the full path including the
  //    /api/auth basePath (so app.use('/api/auth', ...) — which would strip
  //    the prefix — breaks JWKS, authorize, etc).
  const nodeHandler = toNodeHandler(auth);
  router.use((req, res, next) => {
    if (!(req.url.startsWith('/api/auth/') || req.url === '/api/auth')) {
      return next();
    }
    // Block public sign-up entirely — there is exactly one user, seeded
    // in-process from config at boot. The route exists only because
    // emailAndPassword is enabled (for sign-in); we never want HTTP traffic
    // hitting it.
    if (req.url.startsWith('/api/auth/sign-up')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const limiter = req.url.startsWith('/api/auth/sign-in')
      ? credentialLimiter
      : generalAuthLimiter;
    limiter(req, res, (err) => {
      if (err) return next(err);
      nodeHandler(req, res);
    });
  });

  return router;
}
