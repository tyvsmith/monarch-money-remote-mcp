import { Router, type RequestHandler } from 'express';
import * as h from '../handlers.ts';
import type { Verbosity } from '../handlers.ts';

const wrap =
  (fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler =>
  async (req, res, next) => {
    try {
      const data = await fn(req);
      res.json(data);
    } catch (err) {
      next(err);
    }
  };

function parseList(v: unknown): string[] | undefined {
  if (typeof v !== 'string') return undefined;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseNumber(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseBool(v: unknown): boolean | undefined {
  if (typeof v !== 'string') return undefined;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function parseAbsAmountRange(v: unknown): [number?, number?] | undefined {
  if (typeof v !== 'string') return undefined;
  const parts = v.split(',').map((s) => s.trim());
  const min = parts[0] && parts[0] !== '' ? parseNumber(parts[0]) : undefined;
  const max = parts[1] && parts[1] !== '' ? parseNumber(parts[1]) : undefined;
  if (min === undefined && max === undefined) return undefined;
  return [min, max];
}

function parseVerbosity(v: unknown): Verbosity | undefined {
  if (v === 'ultra-light' || v === 'light' || v === 'standard') return v;
  return undefined;
}

export const restRouter: Router = Router();

// ---------- accounts ----------

restRouter.get(
  '/accounts',
  wrap((req) =>
    h.getAccounts({
      includeHidden: parseBool(req.query.includeHidden),
      verbosity: parseVerbosity(req.query.verbosity),
    }),
  ),
);

restRouter.get(
  '/accounts/:id',
  wrap((req) => h.getAccountById(String(req.params.id))),
);

restRouter.get(
  '/accounts/:id/history',
  wrap((req) =>
    h.getAccountHistory(String(req.params.id), {
      startDate: str(req.query.startDate),
      endDate: str(req.query.endDate),
    }),
  ),
);

restRouter.get(
  '/balances',
  wrap((req) =>
    h.getBalances({ startDate: str(req.query.startDate), endDate: str(req.query.endDate) }),
  ),
);

restRouter.get(
  '/networth/history',
  wrap((req) =>
    h.getNetWorthHistory({
      startDate: str(req.query.startDate),
      endDate: str(req.query.endDate),
    }),
  ),
);

// ---------- transactions ----------

restRouter.get(
  '/transactions',
  wrap((req) =>
    h.getTransactions({
      limit: parseNumber(req.query.limit),
      offset: parseNumber(req.query.offset),
      startDate: str(req.query.startDate),
      endDate: str(req.query.endDate),
      categoryIds: parseList(req.query.categoryIds),
      accountIds: parseList(req.query.accountIds),
      tagIds: parseList(req.query.tagIds),
      merchantIds: parseList(req.query.merchantIds),
      search: str(req.query.search),
      isCredit: parseBool(req.query.isCredit),
      absAmountRange: parseAbsAmountRange(req.query.absAmountRange),
    }),
  ),
);

restRouter.get(
  '/transactions/:id',
  wrap((req) => h.getTransactionDetails(String(req.params.id))),
);

restRouter.get('/transactions-summary', wrap(() => h.getTransactionsSummary()));

restRouter.get(
  '/merchants',
  wrap((req) =>
    h.getMerchants({ search: str(req.query.search), limit: parseNumber(req.query.limit) }),
  ),
);

// ---------- budgets ----------

restRouter.get(
  '/budgets',
  wrap((req) =>
    h.getBudgets({
      startDate: str(req.query.startDate),
      endDate: str(req.query.endDate),
      categoryIds: parseList(req.query.categoryIds),
    }),
  ),
);

restRouter.get('/goals', wrap(() => h.getGoals()));

restRouter.get(
  '/bills',
  wrap((req) =>
    h.getBills({
      startDate: str(req.query.startDate),
      endDate: str(req.query.endDate),
      includeCompleted: parseBool(req.query.includeCompleted),
      limit: parseNumber(req.query.limit),
    }),
  ),
);

// ---------- cashflow ----------

restRouter.get(
  '/cashflow',
  wrap((req) =>
    h.getCashflow({
      startDate: str(req.query.startDate),
      endDate: str(req.query.endDate),
      // POST a JSON body for `filters` if you want filters; query strings don't carry nested objects well.
    }),
  ),
);

restRouter.get(
  '/cashflow/summary',
  wrap((req) =>
    h.getCashflowSummary({
      startDate: str(req.query.startDate),
      endDate: str(req.query.endDate),
    }),
  ),
);

// ---------- recurring ----------

restRouter.get(
  '/recurring',
  wrap((req) =>
    h.getRecurringStreams({
      includeLiabilities: parseBool(req.query.includeLiabilities),
      includePending: parseBool(req.query.includePending),
    }),
  ),
);

restRouter.get(
  '/recurring/upcoming',
  wrap((req) => {
    const startDate = str(req.query.startDate);
    const endDate = str(req.query.endDate);
    if (!startDate || !endDate) {
      throw Object.assign(new Error('startDate and endDate query params are required'), {
        statusCode: 400,
      });
    }
    return h.getUpcomingRecurring({ startDate, endDate });
  }),
);

// ---------- categories / tags ----------

restRouter.get('/categories', wrap(() => h.getCategories()));
restRouter.get('/category-groups', wrap(() => h.getCategoryGroups()));
restRouter.get('/tags', wrap(() => h.getTags()));

// ---------- institutions ----------

restRouter.get('/institutions', wrap(() => h.getInstitutions()));
restRouter.get('/institutions/settings', wrap(() => h.getInstitutionSettings()));

// ---------- insights ----------

restRouter.get(
  '/insights',
  wrap((req) =>
    h.getInsights({
      startDate: str(req.query.startDate),
      endDate: str(req.query.endDate),
      insightTypes: parseList(req.query.insightTypes),
    }),
  ),
);

restRouter.get(
  '/credit-score',
  wrap((req) =>
    h.getCreditScore({ includeHistory: parseBool(req.query.includeHistory) }),
  ),
);
