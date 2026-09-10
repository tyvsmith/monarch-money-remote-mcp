import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thinToWeekly, budgetStatus } from '../../src/tools/lib/net-worth.ts';

test('keeps daily under 60 days, weekly plus last point above', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), balance: i }));
  assert.equal(thinToWeekly(rows.slice(0, 30)).length, 30);
  const thin = thinToWeekly(rows);
  assert.equal(thin[0]!.date, '2026-01-01');
  assert.equal(thin.at(-1)!.date, rows.at(-1)!.date);
  assert.ok(thin.length <= 16);
});

test('budgetStatus', () => {
  assert.equal(budgetStatus(100, -120, 'expense'), 'over');
  assert.equal(budgetStatus(100, -50, 'expense'), 'under');
  assert.equal(budgetStatus(100, -95, 'expense'), 'on');
  assert.equal(budgetStatus(0, -5, 'expense'), 'unbudgeted');
  assert.equal(budgetStatus(1000, 900, 'income'), 'under');
});
