import { z } from 'zod';
import { defineTool, isoDate } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { aggregatesQuery, type AggregatesData } from '../../monarch/ops/cashflow.ts';
import { GET_TRANSACTIONS_Q, type TransactionsData } from '../../monarch/ops/transactions.ts';
import { shapeTransaction } from './transactions.ts';

interface CatRef { id: string; name: string; group: { name: string } }

export const GetSpendingByCategory = defineTool({
  name: 'GetSpendingByCategory',
  title: 'Spending by category',
  description: `Get the user's spending broken down by category for a date range.

Returns total spending, the top 5 spending categories (with up to 3 top
merchants in each), and the single largest expense in the period.`,
  readOnly: true,
  idempotent: true,
  input: {
    start_date: isoDate.describe('ISO date string (YYYY-MM-DD), inclusive.'),
    end_date: isoDate.describe('ISO date string, inclusive.'),
    totals_and_categories_only: z
      .boolean()
      .optional()
      .default(false)
      .describe('when true, skip merchant breakdown and the largest-expense lookup. Faster — use for historical comparisons or when only the per-category totals are needed.'),
  },
  handler: async ({ start_date, end_date, totals_and_categories_only }) => {
    const c = await getMonarch();
    const base = { startDate: start_date, endDate: end_date, transactionVisibility: 'non_hidden_transactions_only', categoryType: 'expense' };
    const { aggregates } = await c.query<AggregatesData>(aggregatesQuery(['category']), { filters: base, groupBy: ['category'] });
    // Expense sums are negative: the most spending is the smallest number.
    const cats = aggregates.filter((r) => r.summary.sumExpense < 0).sort((x, y) => x.summary.sumExpense - y.summary.sumExpense);
    const total_spending = Math.abs(cats.reduce((s, r) => s + r.summary.sumExpense, 0));
    const all_categories = cats.map((r) => {
      const k = r.groupBy!.category as CatRef;
      const spent = Math.abs(r.summary.sumExpense);
      return { category_id: k.id, category: k.name, group: k.group.name, spent, transaction_count: r.summary.count, share: total_spending ? spent / total_spending : 0 };
    });
    const top = all_categories.slice(0, 5).map((k) => ({ ...k, top_merchants: [] as Array<{ merchant_id: string; merchant: string; spent: number }> }));
    let largest_expense: ReturnType<typeof shapeTransaction> | null = null;
    if (!totals_and_categories_only) {
      const merchantQueries = top.map((k) =>
        c.query<AggregatesData>(aggregatesQuery(['merchant']), { filters: { ...base, categories: [k.category_id] }, groupBy: ['merchant'] }),
      );
      // TransactionOrdering.amount sorts ascending (most negative first), verified live 2026-09-10; inverse_amount starts at 0.
      const largestQuery = c.query<TransactionsData>(GET_TRANSACTIONS_Q, { filters: { ...base, debitsOnly: true }, limit: 1, offset: 0, orderBy: 'amount' });
      const [perCategory, lg] = await Promise.all([Promise.all(merchantQueries), largestQuery]);
      top.forEach((k, i) => {
        k.top_merchants = perCategory[i]!.aggregates
          .filter((r) => r.summary.sumExpense < 0)
          .sort((x, y) => x.summary.sumExpense - y.summary.sumExpense)
          .slice(0, 3)
          .map((r) => {
            const g = r.groupBy!.merchant as { id: string; name: string };
            return { merchant_id: g.id, merchant: g.name, spent: Math.abs(r.summary.sumExpense) };
          });
      });
      largest_expense = lg.allTransactions.results[0] ? shapeTransaction(lg.allTransactions.results[0], false) : null;
    }
    return { start_date, end_date, total_spending, top_categories: top, all_categories, largest_expense };
  },
});
