import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTransactionFilter } from '../../src/tools/lib/transaction-filters.ts';

const ctx = {
  categories: [{ id: 'c1', name: 'Groceries', groupId: 'g1', groupName: 'Food' }],
  resolveMerchantIds: async (names: string[]) => names.map((n) => `m:${n}`),
  resolveAccountIds: async () => ['a1'],
};

test('defaults: visible only, dates, no type constraint', async () => {
  const f = await buildTransactionFilter({ start_date: '2026-01-01', end_date: '2026-01-31', filters: {} }, ctx);
  assert.deepEqual(f, { startDate: '2026-01-01', endDate: '2026-01-31', transactionVisibility: 'non_hidden_transactions_only' });
});

test('Credit/Debit map to creditsOnly/debitsOnly', async () => {
  assert.equal((await buildTransactionFilter({ filters: { transaction_type: 'Credit' } }, ctx)).creditsOnly, true);
  assert.equal((await buildTransactionFilter({ filters: { transaction_type: 'Debit' } }, ctx)).debitsOnly, true);
});

test('category names resolve to ids and merge with category_ids; group names go to categoryGroups', async () => {
  const f = await buildTransactionFilter({ filters: { transaction_type: 'All', category_ids: ['c9'], categories: ['groceries', 'Food'] } }, ctx);
  assert.deepEqual(f.categories, ['c9', 'c1']);
  assert.deepEqual(f.categoryGroups, ['g1']);
});

test('merchant and account names resolve through the context', async () => {
  const f = await buildTransactionFilter({ filters: { merchants: ['Costco'], accounts: ['Chase'], abs_amount_gte: 50, include_hidden: true } }, ctx);
  assert.deepEqual(f.merchants, ['m:Costco']);
  assert.deepEqual(f.accounts, ['a1']);
  assert.equal(f.absAmountGte, 50);
  assert.equal(f.transactionVisibility, 'all_transactions');
});

test('names that resolve to nothing are errors, not silent widening', async () => {
  const empty = { categories: ctx.categories, resolveMerchantIds: async () => [], resolveAccountIds: async () => [] };
  await assert.rejects(buildTransactionFilter({ filters: { merchants: ['Costcoo'] } }, empty), /merchants not found/);
  await assert.rejects(buildTransactionFilter({ filters: { accounts: ['Bogus'] } }, empty), /accounts not found/);
  await assert.rejects(buildTransactionFilter({ filters: { categories: ['Nonexistent'] } }, empty), /categories not found/);
});
