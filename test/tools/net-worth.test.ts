import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultInterval, thinReadings, budgetStatus } from '../../src/tools/lib/net-worth.ts';

const rows = Array.from({ length: 100 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), balance: i }));

test('defaultInterval follows the official thresholds', () => {
  assert.equal(defaultInterval('2026-01-01', '2026-02-01'), 'day');
  assert.equal(defaultInterval('2026-01-01', '2026-02-02'), 'week');
  assert.equal(defaultInterval('2026-01-01', '2026-04-03'), 'week');
  assert.equal(defaultInterval('2026-01-01', '2026-04-04'), 'month');
});

test('thinReadings keeps every day, every 7th day, or the first of each month, plus the last point', () => {
  assert.equal(thinReadings(rows, 'day').length, 100);
  const weekly = thinReadings(rows, 'week');
  assert.equal(weekly[0]!.date, '2026-01-01');
  assert.equal(weekly[1]!.date, '2026-01-08');
  assert.equal(weekly.at(-1)!.date, rows.at(-1)!.date);
  assert.ok(weekly.length <= 16);
  const monthly = thinReadings(rows, 'month');
  assert.deepEqual(monthly.map((r) => r.date), ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-04-10']);
  assert.deepEqual(thinReadings([], 'month'), []);
});

test('budgetStatus', () => {
  assert.equal(budgetStatus(100, -120, 'expense'), 'over');
  assert.equal(budgetStatus(100, -50, 'expense'), 'under');
  assert.equal(budgetStatus(100, -95, 'expense'), 'on');
  assert.equal(budgetStatus(0, -5, 'expense'), 'unbudgeted');
  assert.equal(budgetStatus(1000, 900, 'income'), 'under');
});
