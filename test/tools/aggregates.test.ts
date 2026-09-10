import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postAggregate } from '../../src/tools/lib/aggregates.ts';
import type { AggregateRow } from '../../src/monarch/ops/cashflow.ts';

const summary = (sum: number, count: number) => ({ sum, sumExpense: sum, sumIncome: 0, savings: 0, savingsRate: 0, count, avg: null, avgExpense: null, avgIncome: null, largest: 0, first: null, last: null });
const rows: AggregateRow[] = [
  { groupBy: { month: '2026-01-01', category: { id: 'a', name: 'A' } }, summary: summary(-10, 1) },
  { groupBy: { month: '2026-02-01', category: { id: 'a', name: 'A' } }, summary: summary(-30, 2) },
  { groupBy: { month: '2026-01-01', category: { id: 'b', name: 'B' } }, summary: summary(-5, 1) },
];

test('avg per category across months', () => {
  const out = postAggregate(rows, { group_by: ['category'], operation: 'avg' });
  assert.deepEqual(out.map((r) => [(r.group.category as { name: string }).name, r.value]), [['A', -20], ['B', -5]]);
});

test('sum per month, and min with limit picks the most negative bucket', () => {
  const out = postAggregate(rows, { group_by: ['month'], operation: 'sum' });
  assert.deepEqual(out.map((r) => [r.group.month, r.value]), [['2026-01-01', -15], ['2026-02-01', -30]]);
  const top = postAggregate(rows, { group_by: ['month'], operation: 'min', limit: 1 });
  assert.deepEqual(top.map((r) => r.value), [-30]);
});

test('count with no dimensions counts all buckets', () => {
  assert.deepEqual(postAggregate(rows, { group_by: [], operation: 'count' }).map((r) => r.value), [3]);
});
