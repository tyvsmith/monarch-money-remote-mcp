import { z } from 'zod';
import { defineTool } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { GET_MERCHANTS_Q, type MerchantsData } from '../../monarch/ops/merchants.ts';

export const GetMerchants = defineTool({
  name: 'GetMerchants',
  title: 'List merchants',
  description: `List the household's merchants.

Returns each merchant's stable \`merchant_id\`, \`name\`, and \`transaction_count\`,
ordered by how many transactions use them. Pass \`merchant_id\` to the write tools
(e.g. CreateTransaction, UpdateMerchant, MergeMerchants). If no merchant matches,
use CreateMerchant to make one.`,
  readOnly: true,
  idempotent: true,
  input: {
    search: z.string().nullable().optional().describe('optional case-insensitive substring filter on merchant name.'),
    limit: z.number().int().optional().default(100).describe('max merchants to return (1-200, default 100).'),
  },
  handler: async ({ search, limit }) => {
    const c = await getMonarch();
    const d = await c.query<MerchantsData>(GET_MERCHANTS_Q, {
      search: search ?? null,
      limit: Math.min(Math.max(limit ?? 100, 1), 200),
      orderBy: 'TRANSACTION_COUNT',
    });
    return { merchants: d.merchants.map((m) => ({ merchant_id: m.id, name: m.name, transaction_count: m.transactionCount })) };
  },
});
