import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeMonarch } from '../helpers/fake-monarch.ts';
import { CreateTransaction, UpdateTransaction, DeleteTransaction } from '../../src/tools/write/transactions.ts';
import { BulkUpdateTransactions, BulkRecategorizeTransactions } from '../../src/tools/write/bulk.ts';
import { UpdateTransactionSplits } from '../../src/tools/write/splits.ts';
import { setMonarchClientForTests } from '../../src/monarch/session.ts';

afterEach(() => setMonarchClientForTests(null));
const run = <T>(tool: { handler: (a: never) => Promise<unknown> }, args: T) => tool.handler(args as never) as Promise<Record<string, any>>;

const txn = (over: Record<string, unknown> = {}) => ({
  id: 'x1', date: '2026-09-01', amount: -0.02, pending: false, isRecurring: false, hideFromReports: false, needsReview: false, reviewStatus: null, notes: null,
  dataProviderDescription: null, isSplitTransaction: false, hasSplitTransactions: false, isManual: true,
  merchant: { id: 'm', name: 'Shop' }, category: { id: 'c', name: 'Cat', group: { id: 'g', name: 'G', type: 'expense' } },
  account: { id: 'a', displayName: 'Checking' }, businessEntity: null, ownedByUser: null, needsReviewByUser: null, goal: null, tags: [], splitTransactions: [], attachments: [],
  ...over,
});

test('CreateTransaction resolves merchant_id to a name and applies hide_from_reports as a second step', async () => {
  const f = installFakeMonarch({
    GetMerchant: { merchant: { id: 'm', name: 'Shop', transactionCount: 1, ruleCount: 0, canBeDeleted: false } },
    CreateTransaction: { createTransaction: { transaction: txn(), errors: null } },
    UpdateTransaction: { updateTransaction: { transaction: txn({ hideFromReports: true }), errors: null } },
  });
  const out = await run(CreateTransaction, { date: '2026-09-01', amount: -0.02, merchant_id: 'm', category_id: 'c', account_id: 'a', hide_from_reports: true });
  assert.equal(out.transaction_id, 'x1');
  assert.equal(out.transaction.hide_from_reports, true);
  assert.deepEqual(f.byOp('CreateTransaction')[0]!.variables, { input: { date: '2026-09-01', amount: -0.02, merchantName: 'Shop', categoryId: 'c', accountId: 'a', shouldUpdateBalance: true } });
  assert.deepEqual(f.byOp('UpdateTransaction')[0]!.variables, { input: { id: 'x1', hideFromReports: true } });
  await assert.rejects(run(CreateTransaction, { date: '2026-09-01', amount: 1, category_id: 'c', account_id: 'a' }), /merchant_id or merchant_name/);
});

test('UpdateTransaction maps fields and sets tags through the separate mutation', async () => {
  const f = installFakeMonarch({
    UpdateTransaction: { updateTransaction: { transaction: txn({ notes: 'n' }), errors: null } },
    SetTransactionTags: { setTransactionTags: { transaction: { id: 'x1', tags: [{ id: 't', name: 'T' }] }, errors: null } },
  });
  const out = await run(UpdateTransaction, { transaction_id: 'x1', notes: 'n', category_id: 'c2', review_status: 'reviewed', merchant_name: 'New Shop', tag_ids: ['t'] });
  assert.deepEqual(f.byOp('UpdateTransaction')[0]!.variables, { input: { id: 'x1', name: 'New Shop', category: 'c2', notes: 'n', reviewed: true } });
  assert.deepEqual(f.byOp('SetTransactionTags')[0]!.variables, { input: { transactionId: 'x1', tagIds: ['t'] } });
  assert.deepEqual(out.transaction.tag_ids, ['t']);
  assert.deepEqual(out.updated_fields, ['name', 'category', 'notes', 'reviewed', 'tag_ids']);
  await assert.rejects(run(UpdateTransaction, { transaction_id: 'x1' }), /no fields/);
});

test('DeleteTransaction', async () => {
  installFakeMonarch({ DeleteTransaction: { deleteTransaction: { deleted: true, errors: null } } });
  assert.deepEqual(await run(DeleteTransaction, { transaction_id: 'x1' }), { deleted: true, transaction_id: 'x1' });
});

test('BulkUpdateTransactions dry run resolves updates without writing; real run sends ids', async () => {
  const f = installFakeMonarch({ BulkUpdateTransactions: { bulkUpdateTransactions: { success: true, affectedCount: 2, errors: null } } });
  const dry = await run(BulkUpdateTransactions, { transaction_ids: ['1', '2'], updates: '{"category_id":"c","hide_from_reports":true,"tag_ids":["t"]}', dry_run: true });
  assert.deepEqual(dry.resolved_updates, { categoryId: 'c', hide: true, tags: ['t'] });
  assert.equal(f.byOp('BulkUpdateTransactions').length, 0);
  const real = await run(BulkUpdateTransactions, { transaction_ids: ['1', '2'], updates: '{"notes":"x"}' });
  assert.equal(real.affected_count, 2);
  assert.deepEqual(f.byOp('BulkUpdateTransactions')[0]!.variables, { selectedTransactionIds: ['1', '2'], allSelected: false, expectedAffectedTransactionCount: 2, updates: { notes: 'x' } });
  await assert.rejects(run(BulkUpdateTransactions, { transaction_ids: ['1'], updates: '{}' }), /no supported fields/);
});

test('BulkRecategorizeTransactions by filters counts first and requires both dates', async () => {
  const f = installFakeMonarch({
    CountTransactions: { allTransactions: { totalCount: 3 } },
    GetTransactions: { allTransactions: { totalCount: 3, results: [txn({ id: 'a' }), txn({ id: 'b' })] } },
    BulkUpdateTransactions: { bulkUpdateTransactions: { success: true, affectedCount: 3, errors: null } },
  });
  const dry = await run(BulkRecategorizeTransactions, { category_id: 'c', filters: '{"start_date":"2026-01-01","end_date":"2026-01-31","merchant_id":"m"}', dry_run: true });
  assert.equal(dry.would_affect_count, 3);
  assert.deepEqual(dry.sample_transaction_ids, ['a', 'b']);
  const real = await run(BulkRecategorizeTransactions, { category_id: 'c', filters: '{"start_date":"2026-01-01","end_date":"2026-01-31","merchant_id":"m"}' });
  assert.equal(real.affected_count, 3);
  const v = f.byOp('BulkUpdateTransactions')[0]!.variables;
  assert.equal(v.allSelected, true);
  assert.deepEqual(v.filters, { startDate: '2026-01-01', endDate: '2026-01-31', transactionVisibility: 'all_transactions', merchants: ['m'] });
  await assert.rejects(run(BulkRecategorizeTransactions, { category_id: 'c', filters: '{"merchant_id":"m"}' }), /both required/);
  await assert.rejects(run(BulkRecategorizeTransactions, { category_id: 'c' }), /exactly one/);
  await assert.rejects(run(BulkRecategorizeTransactions, { category_id: 'c', transaction_ids: ['1'], filters: '{"start_date":"2026-01-01"}' }), /exactly one/);
});

test('UpdateTransactionSplits validates cents and sum, previews, and unsplits with []', async () => {
  const f = installFakeMonarch({
    GetTransaction: { getTransaction: txn({ amount: -0.02 }) },
    UpdateSplits: { updateTransactionSplit: { transaction: { id: 'x1', hasSplitTransactions: true, splitTransactions: [] }, errors: null } },
  });
  await assert.rejects(run(UpdateTransactionSplits, { transaction_id: 'x1', splits: '[{"amount":-0.01},{"amount":-0.005}]' }), /whole cents/);
  await assert.rejects(run(UpdateTransactionSplits, { transaction_id: 'x1', splits: '[{"amount":-0.01},{"amount":-0.02}]' }), /sum/);
  await assert.rejects(run(UpdateTransactionSplits, { transaction_id: 'x1', splits: '[{"amount":-0.02}]' }), /at least two/);
  const dry = await run(UpdateTransactionSplits, { transaction_id: 'x1', splits: '[{"amount":-0.01,"category_id":"c2"},{"amount":-0.01,"merchant_name":"Other"}]', dry_run: true });
  assert.equal(dry.proposed_split_count, 2);
  assert.deepEqual(dry.proposed_splits.map((s: any) => [s.categoryId, s.merchantName]), [['c2', 'Shop'], ['c', 'Other']]);
  assert.equal(f.byOp('UpdateSplits').length, 0);
  await run(UpdateTransactionSplits, { transaction_id: 'x1', splits: '[]' });
  assert.deepEqual(f.byOp('UpdateSplits')[0]!.variables, { input: { transactionId: 'x1', splitData: [] } });
});
