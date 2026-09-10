import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketRecurring, monthlyAmount } from '../../src/tools/lib/recurring.ts';
import type { RecurringItem } from '../../src/monarch/ops/recurring.ts';

const item = (o: { amount?: number; type?: string; liability?: string; frequency?: string }): RecurringItem => ({
  stream: {
    id: 'x', name: 'n', frequency: o.frequency ?? 'monthly', amount: o.amount ?? -10, isActive: true, isApproximate: false, recurringType: null, reviewStatus: null, dayOfTheMonth: 1, baseDate: '2026-01-01', merchant: null,
    creditReportLiabilityAccount: o.liability ? { id: 'l', name: 'card', liabilityType: o.liability } : null,
  },
  account: null,
  category: { id: 'c', name: 'c', group: { id: 'g', name: 'g', type: o.type ?? 'expense' } },
  nextForecastedTransaction: { date: '2026-10-01', amount: o.amount ?? -10 },
});

test('buckets by category type and liability, totals normalized to monthly', () => {
  const b = bucketRecurring([item({ amount: 100, type: 'income' }), item({}), item({ liability: 'CreditCard' }), item({ type: 'transfer' }), item({ amount: -120, frequency: 'yearly' })]);
  assert.equal(b.income.length, 1);
  assert.equal(b.expenses.length, 2);
  assert.equal(b.credit_card_payments.length, 1);
  assert.equal(b.transfers.length, 1);
  assert.equal(b.totals.monthly_income, 100);
  assert.equal(b.totals.monthly_expenses, 20);
});

test('monthlyAmount handles common frequencies', () => {
  assert.equal(monthlyAmount(-12, 'yearly'), 1);
  assert.equal(monthlyAmount(-6, 'semimonthly'), 12);
  assert.equal(monthlyAmount(-7, 'unknown'), 7);
});

test('inbound transfers are transfers, not income', () => {
  const b = bucketRecurring([item({ amount: 1000, type: 'transfer' })]);
  assert.equal(b.transfers.length, 1);
  assert.equal(b.income.length, 0);
  assert.equal(b.totals.monthly_income, 0);
});
