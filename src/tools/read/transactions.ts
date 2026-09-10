import { z } from 'zod';
import { defineTool, isoDate, jsonArg } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import type { MonarchClient } from '../../monarch/client.ts';
import {
  GET_TRANSACTIONS_Q,
  COUNT_TRANSACTIONS_Q,
  type TransactionsData,
  type CountData,
  type Txn,
} from '../../monarch/ops/transactions.ts';
import { GET_CATEGORIES_Q, type CategoryGroupData } from '../../monarch/ops/categories.ts';
import { GET_MERCHANTS_Q, type MerchantsData } from '../../monarch/ops/merchants.ts';
import { GET_ACCOUNTS_Q, type AccountsData } from '../../monarch/ops/accounts.ts';
import { buildTransactionFilter, txnFilterSchema, type FilterContext } from '../lib/transaction-filters.ts';

export async function filterContext(c: MonarchClient): Promise<FilterContext> {
  const { categoryGroups } = await c.query<CategoryGroupData>(GET_CATEGORIES_Q);
  return {
    categories: categoryGroups.flatMap((g) => g.categories.map((k) => ({ id: k.id, name: k.name, groupId: g.id, groupName: g.name }))),
    resolveMerchantIds: async (names) => {
      const ids: string[] = [];
      for (const n of names) {
        const d = await c.query<MerchantsData>(GET_MERCHANTS_Q, { search: n, limit: 25, orderBy: 'TRANSACTION_COUNT' });
        ids.push(...d.merchants.map((m) => m.id));
      }
      return ids;
    },
    resolveAccountIds: async (names) => {
      const { accounts } = await c.query<AccountsData>(GET_ACCOUNTS_Q, { filters: { includeHidden: true } });
      const w = names.map((s) => s.toLowerCase());
      return accounts.filter((a) => w.some((n) => a.displayName.toLowerCase().includes(n))).map((a) => a.id);
    },
  };
}

export const formatAmount = (n: number) => (n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`);

export function shapeTransaction(t: Txn, details: boolean) {
  const base = {
    id: t.id,
    date: t.date,
    amount: t.amount,
    amount_formatted: formatAmount(t.amount),
    pending: t.pending,
    merchant: t.merchant.name,
    merchant_id: t.merchant.id,
    category: t.category.name,
    category_id: t.category.id,
    category_group: t.category.group.name,
    category_type: t.category.group.type,
    account: t.account.displayName,
    account_id: t.account.id,
    business_entity: t.businessEntity?.name ?? null,
    business_entity_id: t.businessEntity?.id ?? null,
    is_split: t.isSplitTransaction,
    has_splits: t.hasSplitTransactions,
  };
  if (!details) return base;
  return {
    ...base,
    notes: t.notes,
    original_statement: t.dataProviderDescription,
    hide_from_reports: t.hideFromReports,
    review_status: t.reviewStatus,
    needs_review: t.needsReview,
    is_recurring: t.isRecurring,
    is_manual: t.isManual,
    owner: t.ownedByUser?.displayName ?? null,
    owner_user_id: t.ownedByUser?.id ?? null,
    needs_review_by: t.needsReviewByUser?.displayName ?? null,
    needs_review_by_user_id: t.needsReviewByUser?.id ?? null,
    goal: t.goal?.name ?? null,
    goal_id: t.goal?.id ?? null,
    tags: t.tags.map((x) => x.name),
    tag_ids: t.tags.map((x) => x.id),
    splits: t.splitTransactions.map((s) => ({
      id: s.id,
      amount: s.amount,
      merchant: s.merchant.name,
      merchant_id: s.merchant.id,
      category: s.category.name,
      category_id: s.category.id,
      notes: s.notes,
      tag_ids: s.tags.map((x) => x.id),
    })),
    attachments: t.attachments.map((a) => ({ id: a.id, filename: a.filename })),
  };
}

export const GetTransactions = defineTool({
  name: 'GetTransactions',
  title: 'Search transactions',
  description: `Search and list the authenticated user's transactions.

Supports fuzzy merchant/account/category matching, business-entity filters,
review-state filters, and free-text search. Returns LLM-friendly JSON with
formatted amounts. Use this for natural-language queries like "my biggest
restaurant charges last month" or "transactions that need review."

Each transaction includes the IDs of its associated entities (\`merchant_id\`,
\`category_id\`, \`account_id\`, \`business_entity_id\`; with \`include_details\` also
\`owner_user_id\`, \`needs_review_by_user_id\`, \`goal_id\`, \`tag_ids\`) to identify
the referenced entities.`,
  readOnly: true,
  idempotent: true,
  input: {
    start_date: isoDate,
    end_date: isoDate,
    filters: z
      .string()
      .optional()
      .default('{"transaction_type": "All"}')
      .describe(
        `JSON string of filters. Omit it or pass "{}" for defaults (transaction_type = 'All', visible-only, no category/merchant/account constraints). transaction_type is 'Credit', 'Debit', or 'All'. To filter by category, pass category_ids (stable IDs from GetCategories or a transaction's category_id) and/or categories (category or category-group NAMES); both are accepted and combined. Also: merchant_ids, merchants (names), account_ids, accounts (names), tag_ids, business_entity_ids, needs_review, is_recurring, has_notes, has_attachments, is_split, is_pending, is_uncategorized, abs_amount_gte, abs_amount_lte, search, include_hidden.`,
      ),
    limit: z.number().int().optional().default(100).describe('maximum transactions to return.'),
    sort_by: z
      .enum(['date', 'inverse_date', 'amount', 'inverse_amount'])
      .optional()
      .default('date')
      .describe("'date' (most recent first), 'inverse_date', 'amount', or 'inverse_amount'."),
    include_details: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'if true, each transaction also includes notes, original_statement, hide_from_reports, review status, recurring flag, ownership, linked goal, tags, splits, and attachments. Forces the result limit to at most 20; pair with narrow filters when using it.',
      ),
    total_count_only: z.boolean().optional().default(false).describe('if true, return only the total count.'),
  },
  handler: async (a) => {
    const c = await getMonarch();
    const filters = jsonArg(a.filters, txnFilterSchema, 'filters');
    const gql = await buildTransactionFilter({ start_date: a.start_date, end_date: a.end_date, filters }, await filterContext(c));
    if (a.total_count_only) {
      const d = await c.query<CountData>(COUNT_TRANSACTIONS_Q, { filters: gql });
      return { total_count: d.allTransactions.totalCount };
    }
    const limit = a.include_details ? Math.min(a.limit ?? 100, 20) : (a.limit ?? 100);
    const d = await c.query<TransactionsData>(GET_TRANSACTIONS_Q, { filters: gql, limit, offset: 0, orderBy: a.sort_by ?? 'date' });
    const results = d.allTransactions.results;
    return {
      total_count: d.allTransactions.totalCount,
      returned: results.length,
      total_amount: results.reduce((s, t) => s + t.amount, 0),
      transactions: results.map((t) => shapeTransaction(t, a.include_details ?? false)),
    };
  },
});
