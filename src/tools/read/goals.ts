import { defineTool } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { GOALS_Q, type GoalsData } from '../../monarch/ops/goals.ts';

export const GetGoals = defineTool({
  name: 'GetGoals',
  title: 'Savings goals',
  description: `List the user's savings goals and progress.

Returns each goal's name, current amount, target amount, and (for goals using
the newer savings-goal model) per-account allocations and totals for
contributions, withdrawals, and rebalancing adjustments.`,
  readOnly: true,
  idempotent: true,
  input: {},
  handler: async () => {
    const c = await getMonarch();
    const d = await c.query<GoalsData>(GOALS_Q);
    return {
      goal_model: d.migratedToSavingsGoals ? 'savings_goals' : 'legacy',
      goals: [
        ...d.savingsGoals
          .filter((g) => !g.isArchived)
          .map((g) => ({
            goal_id: g.id,
            name: g.name,
            type: g.type,
            model: 'savings_goal',
            current_amount: g.currentBalance,
            target_amount: g.targetAmount,
            target_date: g.targetDate,
            progress: g.progress,
            status: g.status,
            is_sinking_fund: g.isSinkingFund,
            estimated_months_to_complete: g.estimatedMonthsUntilCompletion,
            forecasted_completion_date: g.forecastedCompletionDate,
            totals: { contributions: g.contributionTotal, withdrawals: g.withdrawalTotal, rebalancing: g.rebalanceTotal, spending: g.spendingTotal, net: g.netContribution },
            linked_accounts: g.linkedAccounts.filter((a) => a !== null).map((a) => ({ account_id: a.id, name: a.displayName })),
            allocations: (g.allocationAmountsByAccount ?? [])
              .filter((a) => a !== null)
              .map((a) => ({ account_id: a.account.id, account: a.account.displayName, total: a.totalAmount, contributions: a.contributionsAmount, withdrawals: a.withdrawalsAmount, adjustments: a.adjustmentAmount, spending: a.spendingAmount })),
          })),
        ...d.goalsV2
          .filter((g) => !g.archivedAt)
          .map((g) => ({
            goal_id: g.id,
            name: g.name,
            type: g.objective,
            model: 'legacy',
            current_amount: g.currentAmount,
            target_amount: g.targetAmount,
            progress: (g.completionPercent ?? 0) / 100,
            planned_monthly_contribution: g.plannedMonthlyContribution,
            estimated_completion_month: g.estimatedCompletionMonth,
            completed_at: g.completedAt,
            linked_accounts: g.accountAllocations.map((a) => ({ account_id: a.account.id, name: a.account.displayName, amount: a.currentAmount, entire_balance: a.useEntireAccountBalance })),
          })),
      ],
    };
  },
});
