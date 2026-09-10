// GraphQL identifies merchants by name on writes; the official tools take ids.
import type { MonarchClient } from '../../monarch/client.ts';
import { GET_MERCHANT_Q, GET_MERCHANTS_Q, type MerchantData, type MerchantsData } from '../../monarch/ops/merchants.ts';
import { ToolInputError } from '../registry.ts';

export async function findMerchantByExactName(c: MonarchClient, name: string): Promise<{ id: string; name: string } | null> {
  const d = await c.query<MerchantsData>(GET_MERCHANTS_Q, { search: name, limit: 50, orderBy: 'TRANSACTION_COUNT' });
  return d.merchants.find((m) => m.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
}

export async function merchantNameFor(c: MonarchClient, a: { merchant_id?: string | null; merchant_name?: string | null }): Promise<string> {
  if (a.merchant_name?.trim()) return a.merchant_name.trim();
  if (!a.merchant_id) throw new ToolInputError('merchant_id or merchant_name is required');
  const d = await c.query<MerchantData>(GET_MERCHANT_Q, { id: a.merchant_id });
  if (!d.merchant) throw new ToolInputError(`merchant ${a.merchant_id} not found`);
  return d.merchant.name;
}
