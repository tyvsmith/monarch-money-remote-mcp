import { z } from 'zod';
import { defineTool, isoDate, optBool, optNum, optStr, ToolInputError } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import type { MonarchClient } from '../../monarch/client.ts';
import { assertNoPayloadErrors, type PayloadError } from '../lib/mutations.ts';
import {
  GOALS_Q,
  CREATE_SAVINGS_GOALS_Q,
  UPDATE_SAVINGS_GOAL_Q,
  DELETE_SAVINGS_GOAL_Q,
  CONTRIBUTE_Q,
  WITHDRAW_Q,
  CREATE_GOALS_V2_Q,
  UPDATE_GOAL_V2_Q,
  DELETE_GOAL_V2_Q,
  CREATE_ALLOCATION_Q,
  DELETE_ALLOCATION_Q,
  type GoalsData,
} from '../../monarch/ops/goals.ts';

const LEGACY_NOTE = "target_date and is_sinking_fund are not supported on this household's goal model";

/** Which goal model applies: the household default for creates, or the goal's own model for edits. */
async function goalModel(c: MonarchClient, goalId?: string): Promise<{ savings: boolean; data: GoalsData }> {
  const data = await c.query<GoalsData>(GOALS_Q);
  if (goalId) {
    if (data.savingsGoals.some((g) => g.id === goalId)) return { savings: true, data };
    if (data.goalsV2.some((g) => g.id === goalId)) return { savings: false, data };
    throw new ToolInputError(`goal ${goalId} not found`);
  }
  return { savings: data.migratedToSavingsGoals, data };
}

export const CreateGoal = defineTool({
  name: 'CreateGoal',
  title: 'Create goal',
  description: `Create a savings goal for the household.

A new goal starts with a zero balance. To put money toward it, either link accounts whose
balance funds the goal (UpdateGoal with account_ids_to_link) or record a contribution
(ContributeToGoal).`,
  readOnly: false,
  destructive: false,
  input: {
    name: z.string().describe('Goal name.'),
    type: z
      .string()
      .optional()
      .default('savings')
      .describe("Goal objective label, e.g. 'savings' (default), 'emergency_fund', 'home_down_payment', 'car', 'vacation', 'wedding', 'education', 'retirement'."),
    target_amount: optNum.describe('Optional amount you want to save toward this goal.'),
    target_date: optStr.describe('Optional ISO date (YYYY-MM-DD) you want to reach the target by.'),
    is_sinking_fund: z.boolean().optional().default(false).describe('True for a recurring/spend-down fund where linked spending reduces progress.'),
  },
  handler: async ({ name, type, target_amount, target_date, is_sinking_fund }) => {
    const c = await getMonarch();
    const { savings } = await goalModel(c);
    if (savings) {
      const goal: Record<string, unknown> = { name, type: type ?? 'savings', isSinkingFund: is_sinking_fund ?? false };
      if (target_amount != null) goal.targetAmount = target_amount;
      if (target_date != null) goal.targetDate = target_date;
      const d = await c.query<{ createSavingsGoals: { savingsGoals: Array<{ id: string; name: string; type: string }> } }>(CREATE_SAVINGS_GOALS_Q, { input: { goals: [goal] } });
      const g = d.createSavingsGoals.savingsGoals[0]!;
      return { goal_id: g.id, name: g.name, type: g.type, model: 'savings_goal' };
    }
    const goal: Record<string, unknown> = { name, objective: type ?? 'savings' };
    if (target_amount != null) goal.targetAmount = target_amount;
    const d = await c.query<{ createGoals: { goals: Array<{ id: string; name: string; objective: string }>; errors: PayloadError[] | null } }>(CREATE_GOALS_V2_Q, { input: { goals: [goal] } });
    assertNoPayloadErrors(d.createGoals, 'CreateGoal');
    const g = d.createGoals.goals[0]!;
    return { goal_id: g.id, name: g.name, type: g.objective, model: 'legacy', ...(target_date || is_sinking_fund ? { note: LEGACY_NOTE } : {}) };
  },
});

export const UpdateGoal = defineTool({
  name: 'UpdateGoal',
  title: 'Update goal',
  description: `Edit a savings goal and/or change which accounts fund it. Pass only the fields you want to change.

Linking an account funds the goal with that account's whole balance; unlinking returns those
funds. Account IDs come from GetAccounts. The goal ID comes from GetGoals.`,
  readOnly: false,
  destructive: false,
  idempotent: true,
  input: {
    goal_id: z.string().describe('Goal ID from GetGoals.'),
    name: optStr,
    target_amount: optNum,
    target_date: optStr,
    is_sinking_fund: optBool,
    account_ids_to_link: z.array(z.string()).nullable().optional().describe('Account IDs (GetAccounts) to link to this goal.'),
    account_ids_to_unlink: z.array(z.string()).nullable().optional().describe('Account IDs to unlink from this goal.'),
  },
  handler: async (a) => {
    const c = await getMonarch();
    const { savings } = await goalModel(c, a.goal_id);
    if (savings) {
      const input: Record<string, unknown> = { id: a.goal_id };
      if (a.name != null) input.name = a.name;
      if (a.target_amount != null) input.targetAmount = a.target_amount;
      if (a.target_date != null) input.targetDate = a.target_date;
      if (a.is_sinking_fund != null) input.isSinkingFund = a.is_sinking_fund;
      if (a.account_ids_to_link?.length) input.accountIdsToLink = a.account_ids_to_link;
      if (a.account_ids_to_unlink?.length) input.accountIdsToUnlink = a.account_ids_to_unlink;
      type SG = { id: string; name: string; targetAmount: number | null; targetDate: string | null; currentBalance: number; progress: number; isSinkingFund: boolean; linkedAccounts: Array<{ id: string; displayName: string } | null> };
      const d = await c.query<{ updateSavingsGoal: { savingsGoal: SG | null; errors: PayloadError[] | null } }>(UPDATE_SAVINGS_GOAL_Q, { input });
      assertNoPayloadErrors(d.updateSavingsGoal, 'UpdateGoal');
      const g = d.updateSavingsGoal.savingsGoal!;
      return {
        goal_id: g.id,
        name: g.name,
        target_amount: g.targetAmount,
        target_date: g.targetDate,
        current_amount: g.currentBalance,
        progress: g.progress,
        linked_accounts: g.linkedAccounts.filter((x) => x !== null).map((x) => ({ account_id: x.id, name: x.displayName })),
      };
    }
    if (a.name != null || a.target_amount != null) {
      const input: Record<string, unknown> = { id: a.goal_id };
      if (a.name != null) input.name = a.name;
      if (a.target_amount != null) input.targetAmount = a.target_amount;
      const d = await c.query<{ updateGoalV2: { goal: { id: string } | null; errors: PayloadError[] | null } }>(UPDATE_GOAL_V2_Q, { input });
      assertNoPayloadErrors(d.updateGoalV2, 'UpdateGoal');
    }
    for (const id of a.account_ids_to_link ?? []) {
      const d = await c.query<{ createGoalAccountAllocation: { errors: PayloadError[] | null } }>(CREATE_ALLOCATION_Q, {
        input: { goalId: a.goal_id, accountId: id, useEntireAccountBalance: true },
      });
      assertNoPayloadErrors(d.createGoalAccountAllocation, 'UpdateGoal(link)');
    }
    for (const id of a.account_ids_to_unlink ?? []) {
      const d = await c.query<{ deleteGoalAccountAllocation: { errors: PayloadError[] | null } }>(DELETE_ALLOCATION_Q, { input: { goalId: a.goal_id, accountId: id } });
      assertNoPayloadErrors(d.deleteGoalAccountAllocation, 'UpdateGoal(unlink)');
    }
    const g = (await c.query<GoalsData>(GOALS_Q)).goalsV2.find((x) => x.id === a.goal_id)!;
    return {
      goal_id: g.id,
      name: g.name,
      target_amount: g.targetAmount,
      current_amount: g.currentAmount,
      linked_accounts: g.accountAllocations.map((x) => ({ account_id: x.account.id, name: x.account.displayName })),
      ...(a.target_date != null || a.is_sinking_fund != null ? { note: LEGACY_NOTE } : {}),
    };
  },
});

export const DeleteGoal = defineTool({
  name: 'DeleteGoal',
  title: 'Delete goal',
  description: `Delete a savings goal.

The goal must have no linked accounts. If accounts are still linked, the call fails with the
count — unlink them first with UpdateGoal(account_ids_to_unlink=[...]) so their funds are
returned, then retry the delete.`,
  readOnly: false,
  destructive: true,
  input: { goal_id: z.string() },
  handler: async ({ goal_id }) => {
    const c = await getMonarch();
    const { savings, data } = await goalModel(c, goal_id);
    const linked = savings
      ? data.savingsGoals.find((g) => g.id === goal_id)!.linkedAccounts.filter((x) => x !== null).length
      : data.goalsV2.find((g) => g.id === goal_id)!.accountAllocations.length;
    if (linked) throw new ToolInputError(`goal has ${linked} linked account(s); unlink them first with UpdateGoal(account_ids_to_unlink=[...])`);
    if (savings) {
      const d = await c.query<{ deleteSavingsGoal: { success: boolean; errors: Array<{ message: string }> | null } }>(DELETE_SAVINGS_GOAL_Q, { input: { id: goal_id } });
      assertNoPayloadErrors(d.deleteSavingsGoal, 'DeleteGoal');
      return { deleted: d.deleteSavingsGoal.success, goal_id };
    }
    const d = await c.query<{ deleteGoalV2: { success: boolean; errors: PayloadError[] | null } }>(DELETE_GOAL_V2_Q, { input: { id: goal_id } });
    assertNoPayloadErrors(d.deleteGoalV2, 'DeleteGoal');
    return { deleted: d.deleteGoalV2.success, goal_id };
  },
});

const moneyInput = {
  goal_id: z.string().describe('Goal ID from GetGoals.'),
  account_id: z.string().describe('Account ID from GetAccounts.'),
  amount: z.number().positive().describe('Positive amount.'),
  date: optStr.describe('Optional ISO date (YYYY-MM-DD); defaults to today.'),
  notes: optStr.describe('Optional free-text note.'),
};
type GoalEvent = { id: string; goal: { id: string; currentBalance: number; progress: number; status: string | null } } | null;
const moneyVars = (goal_id: string, account_id: string, amount: number, date?: string | null, notes?: string | null) => ({
  input: { id: goal_id, accountId: account_id, amount, ...(date ? { date } : {}), ...(notes ? { notes } : {}) },
});

export const ContributeToGoal = defineTool({
  name: 'ContributeToGoal',
  title: 'Contribute to goal',
  description: "Record a contribution of money from an account into a savings goal.\n\nThe amount must be positive and is limited by the account's available balance (for crypto\naccounts it is capped to what is available, reported back in 'user_notice').",
  readOnly: false,
  destructive: false,
  input: moneyInput,
  handler: async ({ goal_id, account_id, amount, date, notes }) => {
    const c = await getMonarch();
    const { savings } = await goalModel(c, goal_id);
    if (!savings) throw new ToolInputError('contributions require the savings-goal model; this goal uses the legacy model. Link the account with UpdateGoal instead.');
    const d = await c.query<{ createSavingsGoalContribution: { userNotice: string | null; goalEvent: GoalEvent } }>(CONTRIBUTE_Q, moneyVars(goal_id, account_id, amount, date, notes));
    const r = d.createSavingsGoalContribution;
    return { event_id: r.goalEvent?.id ?? null, goal_id, current_amount: r.goalEvent?.goal.currentBalance ?? null, progress: r.goalEvent?.goal.progress ?? null, user_notice: r.userNotice };
  },
});

export const WithdrawFromGoal = defineTool({
  name: 'WithdrawFromGoal',
  title: 'Withdraw from goal',
  description: 'Withdraw money from a savings goal back to an account.\n\nThe amount must be positive and cannot exceed the balance the goal holds from that account.',
  readOnly: false,
  destructive: false,
  input: moneyInput,
  handler: async ({ goal_id, account_id, amount, date, notes }) => {
    const c = await getMonarch();
    const { savings } = await goalModel(c, goal_id);
    if (!savings) throw new ToolInputError('withdrawals require the savings-goal model; this goal uses the legacy model.');
    const d = await c.query<{ createSavingsGoalWithdrawal: { goalEvent: GoalEvent } }>(WITHDRAW_Q, moneyVars(goal_id, account_id, amount, date, notes));
    const r = d.createSavingsGoalWithdrawal;
    return { event_id: r.goalEvent?.id ?? null, goal_id, current_amount: r.goalEvent?.goal.currentBalance ?? null, progress: r.goalEvent?.goal.progress ?? null };
  },
});
