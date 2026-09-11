import { z } from 'zod';
import { defineTool, ToolInputError } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { assertNoPayloadErrors, type PayloadError } from '../lib/mutations.ts';
import { findMerchantByExactName } from '../lib/merchants.ts';
import { UPDATE_MERCHANT_Q, DELETE_MERCHANT_Q, GET_MERCHANT_Q, type MerchantData } from '../../monarch/ops/merchants.ts';

export const CreateMerchant = defineTool({
  name: 'CreateMerchant',
  title: 'Create merchant',
  description: `Create a merchant and return its \`merchant_id\`.

Use this when you need to assign a merchant that does not exist yet: first check
with GetMerchants(search=...); if there is no match, call this to create one, then
pass the returned \`merchant_id\` to a write tool (e.g. CreateTransaction).

If a merchant with this exact name already exists, its \`merchant_id\` is returned
instead of creating a duplicate.

On this server Monarch creates merchants by name on first use, so when no merchant
exists yet this returns \`merchant_id: null\` and \`merchant_name\`; pass \`merchant_name\`
to CreateTransaction / UpdateTransaction / UpdateTransactionSplits and the merchant is
created with that transaction.`,
  readOnly: false,
  destructive: false,
  idempotent: true,
  input: { name: z.string().describe('Merchant name to create.') },
  handler: async ({ name }) => {
    const c = await getMonarch();
    const existing = await findMerchantByExactName(c, name);
    if (existing) return { merchant_id: existing.id, merchant_name: existing.name, created: false, existed: true };
    return {
      merchant_id: null,
      merchant_name: name.trim(),
      created: false,
      existed: false,
      message: 'Monarch creates merchants on first use. Pass merchant_name to the write tool.',
    };
  },
});

export const UpdateMerchant = defineTool({
  name: 'UpdateMerchant',
  title: 'Rename merchant',
  description: 'Rename a merchant.',
  readOnly: false,
  destructive: false,
  idempotent: true,
  input: {
    merchant_id: z.string().describe('ID of the merchant to rename (from GetMerchants / GetTransactions / ListRules).'),
    new_name: z.string().describe('New name. Must not collide with another merchant in the household.'),
  },
  handler: async ({ merchant_id, new_name }) => {
    const c = await getMonarch();
    const d = await c.query<{ updateMerchant: { merchant: { id: string; name: string; transactionCount: number } | null; errors: PayloadError[] | null } }>(
      UPDATE_MERCHANT_Q,
      { input: { merchantId: merchant_id, name: new_name } },
    );
    assertNoPayloadErrors(d.updateMerchant, 'UpdateMerchant');
    const m = d.updateMerchant.merchant!;
    return { merchant_id: m.id, name: m.name, transaction_count: m.transactionCount };
  },
});

export const MergeMerchants = defineTool({
  name: 'MergeMerchants',
  title: 'Merge merchants',
  description: 'Merge multiple merchants into one. Transactions and rules from the source merchants\nare re-pointed to the target, then the sources are deleted.',
  readOnly: false,
  destructive: true,
  input: {
    source_merchant_ids: z.array(z.string()).min(1).describe('List of merchant IDs to merge into the target (from GetMerchants).'),
    target_merchant_id: z.string().describe('ID of the merchant to keep. Must not be in the source list.'),
  },
  handler: async ({ source_merchant_ids, target_merchant_id }) => {
    if (source_merchant_ids.includes(target_merchant_id)) throw new ToolInputError('target_merchant_id must not be in source_merchant_ids');
    const c = await getMonarch();
    const target = (await c.query<MerchantData>(GET_MERCHANT_Q, { id: target_merchant_id })).merchant;
    if (!target) throw new ToolInputError(`target merchant ${target_merchant_id} not found`);
    const merged: string[] = [];
    for (const id of source_merchant_ids) {
      const d = await c.query<{ deleteMerchant: { success: boolean } | null }>(DELETE_MERCHANT_Q, { id, to: target_merchant_id });
      if (!d.deleteMerchant?.success) throw new Error(`merge of ${id} into ${target_merchant_id} failed after merging [${merged.join(', ')}]`);
      merged.push(id);
    }
    const after = (await c.query<MerchantData>(GET_MERCHANT_Q, { id: target_merchant_id })).merchant!;
    return { target_merchant_id, target_name: after.name, merged_merchant_ids: merged, transaction_count: after.transactionCount };
  },
});
