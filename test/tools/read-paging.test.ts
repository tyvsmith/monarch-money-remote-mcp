import { test, afterEach } from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import { installFakeMonarch } from '../helpers/fake-monarch.ts';
import { GetTransactions } from '../../src/tools/read/transactions.ts';
import { GetMerchants } from '../../src/tools/read/merchants.ts';
import { setMonarchClientForTests } from '../../src/monarch/session.ts';

afterEach(() => setMonarchClientForTests(null));
const run = <T>(tool: { handler: (a: never) => Promise<unknown> }, args: T) => tool.handler(args as never) as Promise<Record<string, any>>;

const txn = (id: string) => ({
  id, date: '2026-01-01', amount: -5, pending: false,
  merchant: { id: 'm', name: 'M' }, category: { id: 'c', name: 'C', group: { id: 'g', name: 'G', type: 'expense' } },
  account: { id: 'a', displayName: 'A' }, businessEntity: null, isSplitTransaction: false, hasSplitTransactions: false,
});

test('GetTransactions forwards offset and reports next_offset while more match', async () => {
  const f = installFakeMonarch({ GetTransactions: { allTransactions: { totalCount: 5, results: [txn('a'), txn('b')] } } });
  const out = await run(GetTransactions, { start_date: '2026-01-01', end_date: '2026-01-31', limit: 2, offset: 2 });
  assert.equal(f.byOp('GetTransactions')[0]!.variables.offset, 2);
  assert.equal(out.offset, 2);
  assert.equal(out.next_offset, 4);
  const last = installFakeMonarch({ GetTransactions: { allTransactions: { totalCount: 5, results: [txn('e')] } } });
  const tail = await run(GetTransactions, { start_date: '2026-01-01', end_date: '2026-01-31', limit: 2, offset: 4 });
  assert.equal(last.byOp('GetTransactions')[0]!.variables.offset, 4);
  assert.equal(tail.next_offset, null);
});

test('GetMerchants omits zero-transaction merchants unless asked', async () => {
  const f = installFakeMonarch({ GetMerchants: { merchants: [] } });
  await run(GetMerchants, { search: 'a', limit: 5 });
  assert.equal(f.byOp('GetMerchants')[0]!.variables.includeMerchantsWithoutTransactions, false);
  await run(GetMerchants, { include_merchants_without_transactions: true });
  assert.equal(f.byOp('GetMerchants')[1]!.variables.includeMerchantsWithoutTransactions, true);
});

test('merchant lookups by name still include zero-transaction merchants', async () => {
  const f = installFakeMonarch({ GetMerchants: { merchants: [] }, GetTransactions: { allTransactions: { totalCount: 0, results: [] } } });
  await assert.rejects(run(GetTransactions, { start_date: '2026-01-01', end_date: '2026-01-31', filters: JSON.stringify({ merchants: ['Nope'] }) }));
  assert.equal(f.byOp('GetMerchants')[0]!.variables.includeMerchantsWithoutTransactions, true);
});

test('GetTransactions rejects a limit outside 1-100', async () => {
  installFakeMonarch({ GetTransactions: { allTransactions: { totalCount: 0, results: [] } } });
  const parse = (limit: number) => z.object(GetTransactions.input).safeParse({ start_date: '2026-01-01', end_date: '2026-01-31', limit }).success;
  assert.equal(parse(0), false);
  assert.equal(parse(101), false);
  assert.equal(parse(100), true);
});
