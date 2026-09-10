import type { RecurringItem } from '../../monarch/ops/recurring.ts';

export function shapeRecurring(i: RecurringItem) {
  return {
    stream_id: i.stream.id,
    name: i.stream.name,
    merchant: i.stream.merchant?.name ?? null,
    merchant_id: i.stream.merchant?.id ?? null,
    amount: i.stream.amount,
    is_approximate: i.stream.isApproximate,
    frequency: i.stream.frequency,
    is_active: i.stream.isActive,
    review_status: i.stream.reviewStatus,
    category: i.category?.name ?? null,
    category_id: i.category?.id ?? null,
    account: i.account?.displayName ?? null,
    account_id: i.account?.id ?? null,
    last_paid: i.stream.baseDate,
    next_date: i.nextForecastedTransaction.date,
    next_amount: i.nextForecastedTransaction.amount,
  };
}
type Shaped = ReturnType<typeof shapeRecurring>;

const PER_MONTH: Record<string, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 2,
  monthly: 1,
  quarterly: 1 / 3,
  semiannually: 1 / 6,
  yearly: 1 / 12,
  annually: 1 / 12,
};
export const monthlyAmount = (amount: number | null, freq: string) => Math.abs(amount ?? 0) * (PER_MONTH[freq] ?? 1);

export function bucketRecurring(items: RecurringItem[]) {
  const income: Shaped[] = [];
  const expenses: Shaped[] = [];
  const credit_card_payments: Shaped[] = [];
  const transfers: Shaped[] = [];
  let monthly_expenses = 0;
  let monthly_income = 0;
  for (const i of items) {
    const s = shapeRecurring(i);
    // Monarch's own classification wins; category type is the fallback when it is missing.
    const rt = i.stream.recurringType;
    const t = rt ?? i.category?.group.type;
    if (i.stream.creditReportLiabilityAccount?.liabilityType === 'CreditCard') credit_card_payments.push(s);
    else if (t === 'transfer') transfers.push(s);
    else if (t === 'income' || (rt == null && (i.stream.amount ?? 0) > 0)) {
      income.push(s);
      monthly_income += monthlyAmount(i.stream.amount, i.stream.frequency);
    } else {
      expenses.push(s);
      monthly_expenses += monthlyAmount(i.stream.amount, i.stream.frequency);
    }
  }
  return { income, expenses, credit_card_payments, transfers, totals: { monthly_income, monthly_expenses } };
}
