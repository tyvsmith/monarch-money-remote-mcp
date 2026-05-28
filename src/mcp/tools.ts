import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as h from '../handlers.ts';
import { ResponseFormatter } from '../monarch-client.ts';

const dateRange = {
  startDate: z.string().optional().describe('ISO date YYYY-MM-DD'),
  endDate: z.string().optional().describe('ISO date YYYY-MM-DD'),
};

const verbosity = z
  .enum(['ultra-light', 'light', 'standard'])
  .optional()
  .describe('Response detail level. Default: light. Use ultra-light for big lists.');

const cashflowFilters = {
  search: z.string().optional(),
  categories: z.array(z.string()).optional(),
  accounts: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  minAmount: z.number().optional(),
  maxAmount: z.number().optional(),
};

const recurringFilters = {
  accounts: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  merchants: z.array(z.string()).optional(),
};

const jsonText = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

// All Monarch tools are read-only, idempotent, and bounded to the user's
// own account (no open-internet calls). Spelled out once and reused.
const readOnly = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerTools(server: McpServer): void {
  // ---------- accounts ----------

  server.registerTool(
    'accounts_getAll',
    {
      title: 'List accounts',
      description:
        'List every Monarch account (checking, savings, investment, credit, loan, real estate, etc.) with balances. Use verbosity="ultra-light" for compact responses when you only need names and balances.',
      annotations: readOnly,
      inputSchema: { includeHidden: z.boolean().optional(), verbosity },
    },
    async (args) => jsonText(await h.getAccounts(args)),
  );

  server.registerTool(
    'accounts_getById',
    {
      title: 'Get account by ID',
      description: 'Fetch a single account by id.',
      annotations: readOnly,
      inputSchema: { id: z.string() },
    },
    async ({ id }) => jsonText(await h.getAccountById(id)),
  );

  server.registerTool(
    'accounts_getHistory',
    {
      title: 'Account balance history',
      description: 'Daily balance history for one account.',
      annotations: readOnly,
      inputSchema: { accountId: z.string(), ...dateRange },
    },
    async ({ accountId, startDate, endDate }) =>
      jsonText(await h.getAccountHistory(accountId, { startDate, endDate })),
  );

  server.registerTool(
    'balances_get',
    {
      title: 'Balances over time',
      description: 'Balances across all accounts over a date range.',
      annotations: readOnly,
      inputSchema: dateRange,
    },
    async (args) => jsonText(await h.getBalances(args)),
  );

  server.registerTool(
    'networth_getHistory',
    {
      title: 'Net worth history',
      description: 'Total net worth history (assets minus liabilities) over time.',
      annotations: readOnly,
      inputSchema: dateRange,
    },
    async (args) => jsonText(await h.getNetWorthHistory(args)),
  );

  // ---------- transactions ----------

  server.registerTool(
    'transactions_getTransactions',
    {
      title: 'Search transactions',
      description:
        'Search transactions with filters. Use this for "what did I spend on X", "transactions over $Y", date-range queries, etc. Pass absAmountRange like [50] for ≥$50 or [50,200] for $50–$200. For period totals or category breakdowns, prefer cashflow_get — much smaller payload. **Always pass verbosity="ultra-light" or "light" unless the user needs full transaction detail** — the SDK reformats results into a much smaller text view (cuts tokens 70–95%).',
      annotations: readOnly,
      inputSchema: {
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
        ...dateRange,
        categoryIds: z.array(z.string()).optional(),
        accountIds: z.array(z.string()).optional(),
        tagIds: z.array(z.string()).optional(),
        merchantIds: z.array(z.string()).optional(),
        search: z.string().optional().describe('Free-text search across merchant + notes'),
        isCredit: z
          .boolean()
          .optional()
          .describe('true = inflows only, false = outflows only'),
        absAmountRange: z
          .array(z.number())
          .min(1)
          .max(2)
          .optional()
          .describe(
            'Absolute amount range as [min, max]. Pass [50] for ≥$50, [0,100] for ≤$100, [50,200] for $50–$200.',
          ),
        verbosity,
      },
    },
    async ({ absAmountRange, verbosity: v, ...rest }) => {
      const result = await h.getTransactions({
        ...rest,
        absAmountRange: absAmountRange
          ? ([absAmountRange[0], absAmountRange[1]] as [number?, number?])
          : undefined,
      });
      // Post-format via SDK's ResponseFormatter when caller asks for a
      // compact view. Returns text optimized for LLM consumption — much
      // smaller than the raw JSON for typical "show me my transactions"
      // queries. Falls back to raw JSON for verbosity="standard" or
      // unspecified, since the structured shape may be needed for analysis.
      if (v === 'ultra-light' || v === 'light') {
        const txns = (result as { transactions?: unknown[] }).transactions ?? [];
        return {
          content: [
            {
              type: 'text' as const,
              text: ResponseFormatter.formatTransactions(txns as never[], v, rest.search),
            },
          ],
        };
      }
      return jsonText(result);
    },
  );

  server.registerTool(
    'transactions_getDetails',
    {
      title: 'Get transaction details',
      description: 'Full details for a single transaction.',
      annotations: readOnly,
      inputSchema: { id: z.string() },
    },
    async ({ id }) => jsonText(await h.getTransactionDetails(id)),
  );

  server.registerTool(
    'transactions_getSummary',
    {
      title: 'Transactions summary',
      description: 'Quick summary stats across all visible transactions.',
      annotations: readOnly,
    },
    async () => jsonText(await h.getTransactionsSummary()),
  );

  server.registerTool(
    'merchants_getAll',
    {
      title: 'List merchants',
      description:
        'List merchants. Required to discover merchant IDs for filtering transactions by merchant.',
      annotations: readOnly,
      inputSchema: { search: z.string().optional(), limit: z.number().int().positive().optional() },
    },
    async (args) => jsonText(await h.getMerchants(args)),
  );

  // ---------- budgets ----------

  server.registerTool(
    'budgets_getBudgets',
    {
      title: 'Budgets (planned vs actual)',
      description:
        'Monthly budget data: planned vs actual spending by category and category group.',
      annotations: readOnly,
      inputSchema: { ...dateRange, categoryIds: z.array(z.string()).optional() },
    },
    async (args) => jsonText(await h.getBudgets(args)),
  );

  server.registerTool(
    'budgets_getGoals',
    {
      title: 'Savings & debt goals',
      description: 'Savings and debt-paydown goals with progress.',
      annotations: readOnly,
    },
    async () => jsonText(await h.getGoals()),
  );

  server.registerTool(
    'bills_getAll',
    {
      title: 'Tracked bills',
      description: 'Tracked bills (distinct from recurring transactions).',
      annotations: readOnly,
      inputSchema: {
        ...dateRange,
        includeCompleted: z.boolean().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (args) => jsonText(await h.getBills(args)),
  );

  // ---------- cashflow ----------

  server.registerTool(
    'cashflow_get',
    {
      title: 'Cashflow by category',
      description:
        'Cashflow analysis broken down by category and category group. Prefer this over scanning transactions for period totals, category breakdowns, or month-over-month trends — pre-aggregated by Monarch, much smaller payload.',
      annotations: readOnly,
      inputSchema: {
        ...dateRange,
        filters: z.object(cashflowFilters).optional(),
      },
    },
    async (args) => jsonText(await h.getCashflow(args)),
  );

  server.registerTool(
    'cashflow_getSummary',
    {
      title: 'Cashflow summary',
      description:
        'Single-line cashflow summary: income, expenses, savings, savings rate. Smallest possible payload for "how am I doing this month/year" questions.',
      annotations: readOnly,
      inputSchema: {
        ...dateRange,
        filters: z.object(cashflowFilters).optional(),
      },
    },
    async (args) => jsonText(await h.getCashflowSummary(args)),
  );

  // ---------- recurring ----------

  server.registerTool(
    'recurring_getStreams',
    {
      title: 'Recurring streams',
      description:
        'All known recurring transaction streams (subscriptions, bills, paychecks).',
      annotations: readOnly,
      inputSchema: {
        includeLiabilities: z.boolean().optional(),
        includePending: z.boolean().optional(),
        filters: z.object(recurringFilters).optional(),
      },
    },
    async (args) => jsonText(await h.getRecurringStreams(args)),
  );

  server.registerTool(
    'recurring_getUpcoming',
    {
      title: 'Upcoming recurring',
      description: 'Upcoming recurring transactions in a date window.',
      annotations: readOnly,
      inputSchema: {
        startDate: z.string().describe('ISO date YYYY-MM-DD (required)'),
        endDate: z.string().describe('ISO date YYYY-MM-DD (required)'),
        filters: z.object(recurringFilters).optional(),
      },
    },
    async (args) => jsonText(await h.getUpcomingRecurring(args)),
  );

  // ---------- categories / tags ----------

  server.registerTool(
    'categories_getAll',
    {
      title: 'List categories',
      description: 'All transaction categories.',
      annotations: readOnly,
    },
    async () => jsonText(await h.getCategories()),
  );

  server.registerTool(
    'categories_getGroups',
    {
      title: 'Category groups',
      description: 'All category groups (Income, Expenses, Transfers, etc.).',
      annotations: readOnly,
    },
    async () => jsonText(await h.getCategoryGroups()),
  );

  server.registerTool(
    'tags_getAll',
    {
      title: 'List tags',
      description: 'All transaction tags.',
      annotations: readOnly,
    },
    async () => jsonText(await h.getTags()),
  );

  // ---------- institutions ----------

  server.registerTool(
    'institutions_getAll',
    {
      title: 'Connected institutions',
      description: 'Connected financial institutions.',
      annotations: readOnly,
    },
    async () => jsonText(await h.getInstitutions()),
  );

  server.registerTool(
    'institutions_getSettings',
    {
      title: 'Institution credential health',
      description:
        'Institution credential health: which connections need updates, are disconnected, or are working. Use for "is my Chase connection broken?" questions.',
      annotations: readOnly,
    },
    async () => jsonText(await h.getInstitutionSettings()),
  );

  // ---------- insights ----------

  server.registerTool(
    'insights_getAll',
    {
      title: 'Financial insights',
      description: 'Monarch-generated financial insights and recommendations.',
      annotations: readOnly,
      inputSchema: { ...dateRange, insightTypes: z.array(z.string()).optional() },
    },
    async (args) => jsonText(await h.getInsights(args)),
  );

  server.registerTool(
    'insights_getCreditScore',
    {
      title: 'Credit score',
      description: 'Credit score monitoring data, optionally with history.',
      annotations: readOnly,
      inputSchema: { includeHistory: z.boolean().optional() },
    },
    async (args) => jsonText(await h.getCreditScore(args)),
  );
}
