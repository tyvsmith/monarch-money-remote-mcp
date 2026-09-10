// Translate the official GetTransactions `filters` JSON into Monarch's
// TransactionFilterInput. Names (categories, merchants, accounts) resolve to
// ids through the context so the mapper stays pure and testable.
import { z } from 'zod';

export const txnFilterSchema = z.object({
  transaction_type: z.enum(['Credit', 'Debit', 'All']).optional(),
  category_ids: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(), // category or category-group names
  merchant_ids: z.array(z.string()).optional(),
  merchants: z.array(z.string()).optional(), // names, substring match
  account_ids: z.array(z.string()).optional(),
  accounts: z.array(z.string()).optional(), // names, substring match
  tag_ids: z.array(z.string()).optional(),
  business_entity_ids: z.array(z.string()).optional(),
  include_unassigned_business_entities: z.boolean().optional(),
  needs_review: z.boolean().optional(),
  is_recurring: z.boolean().optional(),
  has_notes: z.boolean().optional(),
  has_attachments: z.boolean().optional(),
  is_split: z.boolean().optional(),
  is_pending: z.boolean().optional(),
  is_uncategorized: z.boolean().optional(),
  hide_from_reports: z.boolean().optional(),
  abs_amount_gte: z.number().optional(),
  abs_amount_lte: z.number().optional(),
  search: z.string().optional(),
  include_hidden: z.boolean().optional(),
});
export type TxnFilterArg = z.infer<typeof txnFilterSchema>;

export interface FilterContext {
  categories: Array<{ id: string; name: string; groupId: string; groupName: string }>;
  resolveMerchantIds: (names: string[]) => Promise<string[]>;
  resolveAccountIds: (names: string[]) => Promise<string[]>;
}
export type TransactionFilterInput = Record<string, unknown>;

const DIRECT: Array<[keyof TxnFilterArg, string]> = [
  ['needs_review', 'needsReview'],
  ['is_recurring', 'isRecurring'],
  ['has_notes', 'hasNotes'],
  ['has_attachments', 'hasAttachments'],
  ['is_split', 'isSplit'],
  ['is_pending', 'isPending'],
  ['is_uncategorized', 'isUncategorized'],
  ['hide_from_reports', 'hideFromReports'],
  ['abs_amount_gte', 'absAmountGte'],
  ['abs_amount_lte', 'absAmountLte'],
  ['search', 'search'],
];

export async function buildTransactionFilter(
  a: { start_date?: string; end_date?: string; filters: TxnFilterArg },
  ctx: FilterContext,
): Promise<TransactionFilterInput> {
  const f = a.filters;
  const out: TransactionFilterInput = {};
  if (a.start_date) out.startDate = a.start_date;
  if (a.end_date) out.endDate = a.end_date;
  out.transactionVisibility = f.include_hidden ? 'all_transactions' : 'non_hidden_transactions_only';
  if (f.transaction_type === 'Credit') out.creditsOnly = true;
  if (f.transaction_type === 'Debit') out.debitsOnly = true;

  const catIds = [...(f.category_ids ?? [])];
  const groupIds = new Set<string>();
  for (const name of f.categories ?? []) {
    const n = name.toLowerCase();
    const cats = ctx.categories.filter((c) => c.name.toLowerCase() === n);
    if (cats.length) {
      catIds.push(...cats.map((c) => c.id));
      continue;
    }
    for (const c of ctx.categories) if (c.groupName.toLowerCase() === n) groupIds.add(c.groupId);
  }
  if (catIds.length) out.categories = catIds;
  if (groupIds.size) out.categoryGroups = [...groupIds];

  const merchants = [...(f.merchant_ids ?? []), ...(f.merchants?.length ? await ctx.resolveMerchantIds(f.merchants) : [])];
  if (merchants.length) out.merchants = merchants;
  const accounts = [...(f.account_ids ?? []), ...(f.accounts?.length ? await ctx.resolveAccountIds(f.accounts) : [])];
  if (accounts.length) out.accounts = accounts;
  if (f.tag_ids?.length) out.tags = f.tag_ids;
  if (f.business_entity_ids?.length || f.include_unassigned_business_entities) {
    out.businessEntitySet = {
      businessEntityIds: f.business_entity_ids ?? [],
      includeUnassigned: f.include_unassigned_business_entities ?? false,
    };
  }
  for (const [src, dst] of DIRECT) if (f[src] !== undefined) out[dst] = f[src];
  return out;
}
