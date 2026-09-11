import { z } from 'zod';
import { defineTool, dryRun, isoDate, jsonArg, ToolInputError } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import type { MonarchClient } from '../../monarch/client.ts';
import {
  BULK_UPDATE_TRANSACTIONS_Q,
  COUNT_TRANSACTIONS_Q,
  GET_TRANSACTIONS_Q,
  type CountData,
  type TransactionsData,
} from '../../monarch/ops/transactions.ts';
import { merchantNameFor } from '../lib/merchants.ts';

const updatesSchema = z.object({
  category_id: z.string().optional(),
  notes: z.string().optional(),
  hide_from_reports: z.boolean().optional(),
  review_status: z.enum(['needs_review', 'reviewed']).optional(),
  is_recurring: z.boolean().optional(),
  needs_review_by_user_id: z.string().optional(),
  owner_user_id: z.string().optional(),
  owner_is_joint: z.boolean().optional(),
  business_entity_id: z.string().optional(),
  tag_ids: z.array(z.string()).optional(),
  merchant_id: z.string().optional(),
  merchant_name: z.string().optional(),
});
type Updates = z.infer<typeof updatesSchema>;

export async function toUpdateParams(c: MonarchClient, u: Updates): Promise<Record<string, unknown>> {
  const p: Record<string, unknown> = {};
  if (u.category_id) p.categoryId = u.category_id;
  if (u.notes !== undefined) p.notes = u.notes;
  if (u.hide_from_reports !== undefined) p.hide = u.hide_from_reports;
  if (u.review_status) p.reviewStatus = u.review_status;
  if (u.is_recurring !== undefined) p.isRecurring = u.is_recurring;
  if (u.needs_review_by_user_id) p.needsReviewByUserId = u.needs_review_by_user_id;
  if (u.owner_user_id) p.ownerUserId = u.owner_user_id;
  if (u.owner_is_joint) p.ownerUserId = null;
  if (u.business_entity_id) p.businessEntityId = u.business_entity_id;
  if (u.tag_ids) p.tags = u.tag_ids;
  if (u.merchant_id || u.merchant_name) p.merchantName = await merchantNameFor(c, u);
  if (!Object.keys(p).length) throw new ToolInputError('updates contains no supported fields');
  return p;
}

interface BulkResult { success: boolean; affectedCount: number | null; errors: Array<{ message: string }> | null }

async function runBulk(c: MonarchClient, sel: { ids?: string[]; filters?: Record<string, unknown> }, updates: Record<string, unknown>, expected: number): Promise<number> {
  const vars = sel.ids
    ? { selectedTransactionIds: sel.ids, allSelected: false, expectedAffectedTransactionCount: expected, updates }
    : { allSelected: true, filters: sel.filters, expectedAffectedTransactionCount: expected, updates };
  const d = await c.query<{ bulkUpdateTransactions: BulkResult }>(BULK_UPDATE_TRANSACTIONS_Q, vars);
  const r = d.bulkUpdateTransactions;
  if (!r.success) {
    throw new ToolInputError(`Monarch rejected the bulk update: ${(r.errors ?? []).map((e) => e.message).join('; ') || 'no detail (the matching set may have changed since the dry run)'}`);
  }
  return r.affectedCount ?? expected;
}

export const BulkUpdateTransactions = defineTool({
  name: 'BulkUpdateTransactions',
  title: 'Bulk update transactions',
  description: 'Apply the same change to many transactions at once: recategorize, tag, mark reviewed, etc.',
  readOnly: false,
  destructive: true,
  input: {
    transaction_ids: z.array(z.string()).min(1).describe('List of IDs from GetTransactions.'),
    updates: z
      .string()
      .describe('JSON object with any subset of: category_id, notes, hide_from_reports, review_status, is_recurring, needs_review_by_user_id, owner_user_id, owner_is_joint, business_entity_id, tag_ids (list of strings), merchant_id or merchant_name. Cross-entity references are IDs from the read tools.'),
    dry_run: dryRun('{would_affect_count, sample_transaction_ids, resolved_updates}'),
  },
  handler: async ({ transaction_ids, updates, dry_run }) => {
    const c = await getMonarch();
    const params = await toUpdateParams(c, jsonArg(updates, updatesSchema, 'updates'));
    if (dry_run) return { dry_run: true, would_affect_count: transaction_ids.length, sample_transaction_ids: transaction_ids.slice(0, 5), resolved_updates: params };
    const affected = await runBulk(c, { ids: transaction_ids }, params, transaction_ids.length);
    return { success: true, affected_count: affected, resolved_updates: params };
  },
});

const recatFilters = z.object({
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  merchant_id: z.string().optional(),
  category_id: z.string().optional(),
  account_id: z.string().optional(),
});

export const BulkRecategorizeTransactions = defineTool({
  name: 'BulkRecategorizeTransactions',
  title: 'Bulk recategorize',
  description: 'Move many transactions into one category in a single call.\n\nUse this for audit-and-fix loops like "put every Costco charge in Groceries."\nProvide exactly one of transaction_ids or filters.',
  readOnly: false,
  destructive: true,
  input: {
    category_id: z.string().describe('target category ID (from GetCategories) applied to every match.'),
    transaction_ids: z.array(z.string()).nullable().optional().describe('explicit IDs from GetTransactions. Mutually exclusive with filters.'),
    filters: z
      .string()
      .nullable()
      .optional()
      .describe('JSON object selecting the transactions to move; mutually exclusive with transaction_ids. Supported keys: start_date and end_date (ISO YYYY-MM-DD, both required when filtering), merchant_id, category_id (the *current* category to move out of), account_id. All IDs come from the read tools.'),
    dry_run: dryRun('{would_affect_count, requested_count, sample_transaction_ids, target_category_id}'),
  },
  handler: async ({ category_id, transaction_ids, filters, dry_run }) => {
    const hasIds = !!transaction_ids?.length;
    const hasFilters = !!filters && filters.trim() !== '' && filters.trim() !== '{}';
    if (hasIds === hasFilters) throw new ToolInputError('provide exactly one of transaction_ids or filters');
    const c = await getMonarch();
    const updates = { categoryId: category_id };
    if (hasIds) {
      const ids = transaction_ids!;
      if (dry_run) return { dry_run: true, would_affect_count: ids.length, requested_count: ids.length, sample_transaction_ids: ids.slice(0, 5), target_category_id: category_id };
      const affected = await runBulk(c, { ids }, updates, ids.length);
      return { success: true, affected_count: affected, target_category_id: category_id };
    }
    const f = jsonArg(filters, recatFilters, 'filters');
    if (!f.start_date || !f.end_date) throw new ToolInputError('filters.start_date and filters.end_date are both required');
    const gql: Record<string, unknown> = { startDate: f.start_date, endDate: f.end_date, transactionVisibility: 'all_transactions' };
    if (f.merchant_id) gql.merchants = [f.merchant_id];
    if (f.category_id) gql.categories = [f.category_id];
    if (f.account_id) gql.accounts = [f.account_id];
    const count = (await c.query<CountData>(COUNT_TRANSACTIONS_Q, { filters: gql })).allTransactions.totalCount;
    const sample = (await c.query<TransactionsData>(GET_TRANSACTIONS_Q, { filters: gql, limit: 5, offset: 0, orderBy: 'date' })).allTransactions.results.map((t) => t.id);
    if (dry_run) return { dry_run: true, would_affect_count: count, requested_count: count, sample_transaction_ids: sample, target_category_id: category_id };
    if (count === 0) return { success: true, affected_count: 0, target_category_id: category_id };
    const affected = await runBulk(c, { filters: gql }, updates, count);
    return { success: true, affected_count: affected, target_category_id: category_id };
  },
});
