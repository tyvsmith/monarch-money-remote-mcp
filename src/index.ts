import express, { type ErrorRequestHandler } from 'express';
import { config } from './config.ts';
import { apiKeyAuth } from './auth.ts';
import { buildAuthRouter } from './auth/router.ts';
import { restRouter } from './rest/router.ts';
import { mcpHandler } from './mcp/server.ts';

// Fail fast on missing credentials before serving anything.
void config.monarchEmail;
void config.monarchPassword;
void config.wrapperApiKey;

const app = express();

app.disable('x-powered-by');
// Cloud Run terminates at Google Front End, which forwards X-Forwarded-For.
// Trusting exactly one hop lets express-rate-limit (and req.ip) use the real
// client IP without exposing us to spoofing from upstream proxies.
app.set('trust proxy', 1);

// Better-auth needs the raw Web-style request — mount its handler BEFORE the
// JSON body parser. The well-known metadata router has no body needs either,
// so it sits in front too.
const authRouter = await buildAuthRouter();
app.use(authRouter);

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const auth = apiKeyAuth(config.wrapperApiKey);

app.post('/mcp', auth, mcpHandler);
app.use('/', auth, restRouter);

// Only errors raised outside tool handlers reach here (body parsing, auth
// middleware); invokeTool maps everything from tools itself.
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const e = err as { statusCode?: unknown; code?: unknown; message?: unknown; stack?: unknown };
  const status = typeof e.statusCode === 'number' ? e.statusCode : 500;
  const message = err instanceof Error ? err.message : 'internal error';
  console.error('[error]', { method: req.method, path: req.originalUrl, status, message, stack: e.stack });
  res.status(status).json({ error: message, code: typeof e.code === 'string' ? e.code : undefined });
};
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`monarch-money-remote-mcp listening on :${config.port}`);
});
