import { z } from 'zod';
import { defineTool, jsonArg, ToolInputError } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { assertNoPayloadErrors, type PayloadError } from '../lib/mutations.ts';
import { merchantNameFor } from '../lib/merchants.ts';
import { assertWholeCents } from '../lib/cents.ts';
import { GET_TRANSACTION_Q, UPDATE_SPLITS_Q, type TransactionData } from '../../monarch/ops/transactions.ts';

const splitSchema = z.array(
  z.object({
    amount: z.number(),
    merchant_id: z.string().optional(),
    merchant_name: z.string().optional(),
    category_id: z.string().optional(),
    notes: z.string().optional(),
    hide_from_reports: z.boolean().optional(),
    tag_ids: z.array(z.string()).optional(),
  }),
);

interface SplitRow { id: string; amount: number; notes: string | null; merchant: { id: string; name: string }; category: { id: string; name: string }; tags: Array<{ id: string; name: string }> }

export const UpdateTransactionSplits = defineTool({
  name: 'UpdateTransactionSplits',
  title: 'Replace splits',
  description: 'Replace the splits on a transaction.',
  readOnly: false,
  destructive: true,
  input: {
    transaction_id: z.string().describe('ID of the parent transaction.'),
    splits: z
      .string()
      .describe("JSON list. Pass [] to unsplit. Each entry must include amount (signed the same way as the parent; outflow negative) and may include merchant_id or merchant_name, category_id, notes, hide_from_reports, tag_ids. Amounts must be whole cents and sum to the parent's amount."),
    dry_run: z
      .boolean()
      .optional()
      .default(false)
      .describe('if true, returns a preview ({transaction_amount, current_splits, proposed_splits, proposed_split_count}) without writing. Call once with dry_run=true to show the user the proposed split structure, then call again with dry_run=false to commit.'),
  },
  handler: async ({ transaction_id, splits, dry_run }) => {
    const c = await getMonarch();
    const parent = (await c.query<TransactionData>(GET_TRANSACTION_Q, { id: transaction_id })).getTransaction;
    if (!parent) throw new ToolInputError(`transaction ${transaction_id} not found`);
    const proposed = jsonArg(splits, splitSchema, 'splits');
    if (proposed.length === 1) throw new ToolInputError('a split needs at least two entries, or [] to unsplit');
    if (proposed.length) assertWholeCents(proposed.map((s) => s.amount), parent.amount);
    const splitData = [];
    for (const s of proposed) {
      splitData.push({
        amount: s.amount,
        categoryId: s.category_id ?? parent.category.id,
        merchantName: s.merchant_id || s.merchant_name ? await merchantNameFor(c, s) : parent.merchant.name,
        notes: s.notes ?? null,
        hideFromReports: s.hide_from_reports ?? null,
        ...(s.tag_ids ? { tags: s.tag_ids } : {}),
      });
    }
    const current = parent.splitTransactions.map((s) => ({ id: s.id, amount: s.amount, merchant: s.merchant.name, category_id: s.category.id }));
    if (dry_run) return { dry_run: true, transaction_amount: parent.amount, current_splits: current, proposed_splits: splitData, proposed_split_count: splitData.length };
    const d = await c.query<{ updateTransactionSplit: { transaction: { id: string; hasSplitTransactions: boolean; splitTransactions: SplitRow[] } | null; errors: PayloadError[] | null } }>(
      UPDATE_SPLITS_Q,
      { input: { transactionId: transaction_id, splitData } },
    );
    assertNoPayloadErrors(d.updateTransactionSplit, 'UpdateTransactionSplits');
    const t = d.updateTransactionSplit.transaction!;
    return {
      transaction_id: t.id,
      is_split: t.hasSplitTransactions,
      splits: t.splitTransactions.map((s) => ({ split_id: s.id, amount: s.amount, merchant: s.merchant.name, merchant_id: s.merchant.id, category: s.category.name, category_id: s.category.id, notes: s.notes })),
    };
  },
});
