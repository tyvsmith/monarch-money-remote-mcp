// WORKAROUND FILE — delete when monarchmoney SDK fixes these upstream.
//
// monarchmoney@1.1.3 ships several broken GraphQL queries (wrong root field
// names, deprecated/invented fields, fabricated schemas). Each export here
// replaces one broken SDK method by either posting a corrected query
// directly to https://api.monarch.com/graphql using the SDK's authenticated
// session, or by reusing a working sibling SDK method.
//
// Sources for the corrected queries:
//   - keithah/monarchmoney-ts#8                  (tags, cashflow)
//   - gserafini/monarchmoney-ts:feat/reports-api (goals, categoryGroups,
//                                                 insights, creditScore, cashflow)
//   - keithah/monarchmoney-ts:v2-rewrite         (transactionDetails)
//
// When upstream merges PR #8 plus ships the v2 rewrite (or backports its
// fixes into v1.x), delete this file and rewire handlers.ts back to the
// SDK methods.

import { getMonarchClient } from './monarch-client.ts';

const MONARCH_GRAPHQL_URL =
  (process.env.MONARCH_BASE_URL ?? 'https://api.monarch.com') + '/graphql';

interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
}
interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

async function graphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const client = await getMonarchClient();
  const token = client.getSessionInfo().token;
  if (!token) throw new Error('No Monarch session token available');

  const res = await fetch(MONARCH_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token}`,
      Accept: 'application/json',
      'Client-Platform': 'web',
      Origin: 'https://app.monarchmoney.com',
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors?.length) {
    const detail = body.errors
      .map(
        (e) =>
          `${e.message}${
            e.locations?.length
              ? ` @ ${e.locations.map((l) => `${l.line}:${l.column}`).join(',')}`
              : ''
          }`,
      )
      .join('; ');
    const err = new Error(`Monarch GraphQL error: ${detail}`) as Error & {
      statusCode?: number;
      query?: string;
    };
    err.statusCode = res.status >= 400 ? res.status : 502;
    err.query = query;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Monarch HTTP ${res.status}`) as Error & {
      statusCode?: number;
    };
    err.statusCode = res.status;
    throw err;
  }
  if (!body.data) throw new Error('Monarch GraphQL returned no data');
  return body.data;
}

function notImplemented(method: string, reason: string): never {
  const err = new Error(
    `${method} is not currently supported. ${reason}`,
  ) as Error & { statusCode: number };
  err.statusCode = 501;
  throw err;
}

// SDK queries `transactionTags` (doesn't exist). Real field: householdTransactionTags.
export async function getTags(): Promise<unknown[]> {
  const data = await graphql<{ householdTransactionTags: unknown[] }>(`
    query GetHouseholdTransactionTags {
      householdTransactionTags { id name color order __typename }
    }
  `);
  return data.householdTransactionTags ?? [];
}

// SDK queries `transactionCategoryGroups` (doesn't exist). Groups live inside
// each Category, so we dedupe from the SDK's working getCategories() result.
export async function getCategoryGroups(): Promise<unknown[]> {
  const c = await getMonarchClient();
  const categories = (await c.categories.getCategories()) as Array<{
    group?: { id?: string };
  }>;
  const seen = new Map<string, unknown>();
  for (const cat of categories) {
    const g = cat.group;
    if (g?.id && !seen.has(g.id)) seen.set(g.id, g);
  }
  return [...seen.values()];
}

// SDK queries root `goals` (doesn't exist). Real schema exposes goalsV2 inside
// the budget query, which the SDK's working getBudgets() already fetches.
export async function getGoals(): Promise<unknown[]> {
  const c = await getMonarchClient();
  const budget = (await c.budgets.getBudgets({})) as { goalsV2?: unknown[] };
  return budget.goalsV2 ?? [];
}

// SDK queries `getTransaction` with several invalid fields (color, isHide,
// importIdentifier, plaidTransactionId, dataProvider). Replace with the v2
// GetTransactionDrawer query.
// Real query captured from Monarch's web app. The `$id` variable is `UUID!`,
// not `String!`/`ID!` — that's what every SDK fork got wrong.
export async function getTransactionDetails(id: string): Promise<unknown> {
  const data = await graphql<{ getTransaction: unknown }>(
    `
    query GetTransactionDrawer($id: UUID!, $redirectPosted: Boolean) {
      getTransaction(id: $id, redirectPosted: $redirectPosted) {
        id amount pending isRecurring date originalDate
        hideFromReports hiddenByAccount needsReview reviewedAt reviewStatus
        plaidName notes isSplitTransaction hasSplitTransactions
        dataProviderDescription deletedAt isManual
        splitTransactions {
          id amount
          merchant { id name __typename }
          category { id name icon __typename }
          __typename
        }
        attachments { id extension filename __typename }
        category { id name icon group { id type __typename } __typename }
        merchant { id name logoUrl __typename }
        account { id displayName icon logoUrl __typename }
        tags { id name color order __typename }
        goal { id name __typename }
        __typename
      }
    }
  `,
    { id, redirectPosted: false },
  );
  return data.getTransaction;
}

// SDK uses GraphQL aliases on aggregates queries; Monarch's API rejects them.
// Replace with two parallel aggregates queries.
export async function getCashflow(range: {
  startDate?: string;
  endDate?: string;
}): Promise<unknown> {
  const filters = {
    search: '',
    categories: [],
    accounts: [],
    tags: [],
    ...(range.startDate ? { startDate: range.startDate } : {}),
    ...(range.endDate ? { endDate: range.endDate } : {}),
  };

  const makeQuery = (groupBy: 'category' | 'categoryGroup') => `
    query ($filters: TransactionFilterInput) {
      aggregates(filters: $filters, groupBy: ["${groupBy}"]) {
        groupBy {
          ${
            groupBy === 'category'
              ? 'category { id name group { id type __typename } __typename }'
              : 'categoryGroup { id name type __typename }'
          }
          __typename
        }
        summary { sum __typename }
        __typename
      }
    }
  `;

  const [byCategory, byCategoryGroup] = await Promise.all([
    graphql<{ aggregates: unknown[] }>(makeQuery('category'), { filters }),
    graphql<{ aggregates: unknown[] }>(makeQuery('categoryGroup'), { filters }),
  ]);

  return {
    byCategory: byCategory.aggregates,
    byCategoryGroup: byCategoryGroup.aggregates,
  };
}

// SDK queries root `insights(...)` (doesn't exist). Real dashboard advice
// lives under adviceItems via Web_GetAdviceDashboardWidget.
export async function getInsights(): Promise<unknown[]> {
  const data = await graphql<{ adviceItems: unknown[] }>(`
    query Web_GetAdviceDashboardWidget {
      adviceItems(group: "objective") {
        id title numTasksCompleted numTasks completedAt
        category { name displayName color __typename }
        __typename
      }
    }
  `);
  return data.adviceItems ?? [];
}

// SDK returns silently-empty arrays. Real credit-score data lives under
// spinwheelUser via Common_GetSpinwheelCreditScoreSnapshots.
export async function getCreditScore(): Promise<unknown> {
  const data = await graphql<{ spinwheelUser: unknown }>(`
    query Common_GetSpinwheelCreditScoreSnapshots {
      spinwheelUser {
        id spinwheelUserId creditScoreRefreshSubscriptionId
        creditScoreTrackingStatus isBillSyncTrackingEnabled
        onboardingStatus onboardingErrorMessage
        user { id name displayName __typename }
        __typename
      }
    }
  `);
  return data.spinwheelUser ?? null;
}

// No fork has a working query for these. Throw 501 so the Custom GPT sees a
// clear "unsupported" signal instead of a 500 from a broken upstream query.
// Real query captured from Monarch's web app. The SDK's `transactionsSummary`
// root field doesn't exist; the web app composes the summary from two real
// queries: `allTransactions(filters).totalCount` and the `aggregates(filters,
// fillEmptyValues: true).summary` field (also used by /cashflow/summary).
// We run both in parallel and merge.
export async function getTransactionsSummary(): Promise<unknown> {
  const filters = { transactionVisibility: 'non_hidden_transactions_only' };

  const [countRes, aggRes] = await Promise.all([
    graphql<{ allTransactions: { totalCount: number } }>(
      `
      query Web_GetTransactionsSummaryCard($filters: TransactionFilterInput!) {
        allTransactions(filters: $filters) {
          totalCount
          __typename
        }
      }
    `,
      { filters },
    ),
    graphql<{
      aggregates: Array<{
        summary: {
          sumIncome?: number;
          sumExpense?: number;
          savings?: number;
          savingsRate?: number;
        };
      }>;
    }>(
      `
      query GetTransactionsSummaryAggregate($filters: TransactionFilterInput) {
        aggregates(filters: $filters, fillEmptyValues: true) {
          summary { sumIncome sumExpense savings savingsRate __typename }
          __typename
        }
      }
    `,
      { filters },
    ),
  ]);

  const summary = aggRes.aggregates?.[0]?.summary ?? {};
  return {
    totalCount: countRes.allTransactions?.totalCount ?? 0,
    sumIncome: summary.sumIncome ?? 0,
    sumExpense: summary.sumExpense ?? 0,
    savings: summary.savings ?? 0,
    savingsRate: summary.savingsRate ?? 0,
  };
}

// No standalone `merchants(search, limit)` root field exists; the
// `transactionFiltersMetadata.merchants` field only returns data when a
// merchant filter is already applied. Instead we aggregate transactions
// by merchant — every merchant with activity appears in the result.
export async function getMerchants(
  opts: { search?: string; limit?: number } = {},
): Promise<unknown[]> {
  const data = await graphql<{
    aggregates: Array<{
      groupBy: { merchant: { id: string; name: string; logoUrl?: string } };
      summary: { sumIncome?: number; sumExpense?: number };
    }>;
  }>(
    `
    query GetMerchantsByAggregate($filters: TransactionFilterInput) {
      aggregates(filters: $filters, groupBy: ["merchant"]) {
        groupBy {
          merchant { id name logoUrl __typename }
          __typename
        }
        summary { sumIncome sumExpense __typename }
        __typename
      }
    }
  `,
    { filters: { transactionVisibility: 'non_hidden_transactions_only' } },
  );

  let merchants = (data.aggregates ?? []).map((a) => ({
    ...a.groupBy.merchant,
    sumIncome: a.summary?.sumIncome,
    sumExpense: a.summary?.sumExpense,
  }));
  if (opts.search) {
    const s = opts.search.toLowerCase();
    merchants = merchants.filter((m) => m.name?.toLowerCase().includes(s));
  }
  if (opts.limit && opts.limit > 0) {
    merchants = merchants.slice(0, opts.limit);
  }
  return merchants;
}

// Real query captured from Monarch's web app. The SDK's `bills` root field
// doesn't exist — Monarch exposes bills via `aggregatedRecurringItems`
// grouped by status. We support startDate/endDate/includeCompleted/limit
// client-side.
export async function getBills(
  opts: {
    startDate?: string;
    endDate?: string;
    includeCompleted?: boolean;
    limit?: number;
  } = {},
): Promise<unknown> {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const firstOfMonth = `${yyyy}-${mm}-01`;
  const lastDay = new Date(Date.UTC(yyyy, now.getUTCMonth() + 1, 0)).getUTCDate();
  const lastOfMonth = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;

  const data = await graphql<{
    aggregatedRecurringItems: {
      groups: Array<{
        groupBy: { status: string };
        results: Array<{ isCompleted?: boolean }>;
        summary?: unknown;
      }>;
      aggregatedSummary?: unknown;
    };
  }>(
    `
    query Common_GetAggregatedRecurringItems(
      $startDate: Date!
      $endDate: Date!
      $filters: RecurringTransactionFilter
    ) {
      aggregatedRecurringItems(
        startDate: $startDate
        endDate: $endDate
        groupBy: "status"
        filters: $filters
      ) {
        groups {
          groupBy { status __typename }
          results {
            stream {
              id name frequency amount isActive logoUrl isApproximate
              merchant { id name logoUrl __typename }
              __typename
            }
            date isPast isLate markedPaidAt isCompleted transactionId
            amount amountDiff isAmountDifferentThanOriginal
            category { id name icon __typename }
            account { id displayName icon logoUrl __typename }
            __typename
          }
          summary {
            expense { total __typename }
            creditCard { total __typename }
            income { total __typename }
            __typename
          }
          __typename
        }
        aggregatedSummary {
          expense { completed remaining total count __typename }
          creditCard { completed remaining total count __typename }
          income { completed remaining total __typename }
          __typename
        }
        __typename
      }
    }
  `,
    {
      startDate: opts.startDate ?? firstOfMonth,
      endDate: opts.endDate ?? lastOfMonth,
      filters: {},
    },
  );

  let result = data.aggregatedRecurringItems;
  if (opts.includeCompleted === false) {
    result = {
      ...result,
      groups: result.groups.map((g) => ({
        ...g,
        results: g.results.filter((r) => !r.isCompleted),
      })),
    };
  }
  if (opts.limit && opts.limit > 0) {
    let remaining = opts.limit;
    result = {
      ...result,
      groups: result.groups.map((g) => {
        const trimmed = g.results.slice(0, Math.max(0, remaining));
        remaining -= trimmed.length;
        return { ...g, results: trimmed };
      }),
    };
  }
  return result;
}
