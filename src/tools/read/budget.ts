import { z } from 'zod';
import { defineTool, isoDate } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { BUDGET_Q, type BudgetData, type BudgetMonthlyAmount } from '../../monarch/ops/budget.ts';
import { budgetStatus } from '../lib/net-worth.ts';

const monthStart = (d: string) => d.slice(0, 7) + '-01';

export const GetBudget = defineTool({
  name: 'GetBudget',
  title: 'Budget',
  description: `Get the user's budget for a date range.

Returns budgeted amounts per category (or category group, depending on the
user's setup), monthly and overall totals, and — when \`include_actuals\` is
true — actual spending for each line plus an "over/under/on budget" status.`,
  readOnly: true,
  idempotent: true,
  input: {
    start_date: isoDate.describe('ISO date string (YYYY-MM-DD). Will be clamped to start of month.'),
    end_date: isoDate.describe('ISO date string. Will be clamped to start of month.'),
    include_actuals: z
      .boolean()
      .optional()
      .default(false)
      .describe('when true, also include per-line actual spending and over/under-budget status. Use this for budget-vs-actual comparisons.'),
  },
  handler: async ({ start_date, end_date, include_actuals }) => {
    const c = await getMonarch();
    const d = await c.query<BudgetData>(BUDGET_Q, { startMonth: monthStart(start_date), endMonth: monthStart(end_date) });
    const actuals = include_actuals ?? false;
    const line = (name: string, id: string, group: string | null, type: string, amounts: BudgetMonthlyAmount[]) => ({
      id,
      name,
      group,
      type,
      months: amounts.map((m) => ({
        month: m.month,
        budgeted: m.plannedAmount ?? 0,
        rollover_in: m.previousMonthRolloverAmount ?? 0,
        ...(actuals ? { actual: m.actualAmount ?? 0, remaining: m.remainingAmount ?? 0, status: budgetStatus(m.plannedAmount, m.actualAmount, type) } : {}),
      })),
      total_budgeted: amounts.reduce((s, m) => s + (m.plannedAmount ?? 0), 0),
      ...(actuals ? { total_actual: amounts.reduce((s, m) => s + (m.actualAmount ?? 0), 0) } : {}),
    });
    const tot = (t: { plannedAmount: number | null; actualAmount: number | null; remainingAmount: number | null }) => ({
      budgeted: t.plannedAmount ?? 0,
      ...(actuals ? { actual: t.actualAmount ?? 0, remaining: t.remainingAmount ?? 0 } : {}),
    });
    const groupLevel = new Set(
      d.budgetData.monthlyAmountsByCategoryGroup.filter((g) => g.categoryGroup.groupLevelBudgetingEnabled).map((g) => g.categoryGroup.id),
    );
    return {
      budget_system: d.budgetSystem,
      start_month: monthStart(start_date),
      end_month: monthStart(end_date),
      categories: d.budgetData.monthlyAmountsByCategory
        .filter((x) => !groupLevel.has(x.category.group.id))
        .map((x) => line(x.category.name, x.category.id, x.category.group.name, x.category.group.type, x.monthlyAmounts)),
      category_groups: d.budgetData.monthlyAmountsByCategoryGroup.map((x) => ({
        ...line(x.categoryGroup.name, x.categoryGroup.id, null, x.categoryGroup.type, x.monthlyAmounts),
        budgeted_at_group_level: groupLevel.has(x.categoryGroup.id),
      })),
      flex: d.budgetSystem === 'FLEX' ? line('Flexible expenses', 'flex', null, 'expense', d.budgetData.monthlyAmountsForFlexExpense.monthlyAmounts) : null,
      totals_by_month: d.budgetData.totalsByMonth.map((t) => ({
        month: t.month,
        income: tot(t.totalIncome),
        expenses: tot(t.totalExpenses),
        fixed: tot(t.totalFixedExpenses),
        flexible: tot(t.totalFlexibleExpenses),
        non_monthly: tot(t.totalNonMonthlyExpenses),
      })),
    };
  },
});
