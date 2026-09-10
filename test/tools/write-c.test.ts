import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeMonarch } from '../helpers/fake-monarch.ts';
import { CreateGoal, UpdateGoal, DeleteGoal, ContributeToGoal, WithdrawFromGoal } from '../../src/tools/write/goals.ts';
import { setMonarchClientForTests } from '../../src/monarch/session.ts';

afterEach(() => setMonarchClientForTests(null));
const run = <T>(tool: { handler: (a: never) => Promise<unknown> }, args: T) => tool.handler(args as never) as Promise<Record<string, any>>;

const legacyGoal = (id: string, allocs = 0) => ({ id, name: 'L', objective: 'savings', type: 'asset', targetAmount: 1, currentAmount: 0, completionPercent: 0, plannedMonthlyContribution: null, estimatedCompletionMonth: null, archivedAt: null, completedAt: null, priority: 0, accountAllocations: Array.from({ length: allocs }, (_, i) => ({ id: `al${i}`, currentAmount: 1, useEntireAccountBalance: true, account: { id: `a${i}`, displayName: `A${i}` } })) });
const savingsGoal = (id: string, linked: string[] = []) => ({ id, name: 'S', type: 'savings', targetAmount: 1, targetDate: null, currentBalance: 0, progress: 0, status: null, isSinkingFund: false, isArchived: false, contributionTotal: 0, withdrawalTotal: 0, rebalanceTotal: 0, spendingTotal: 0, netContribution: 0, estimatedMonthsUntilCompletion: null, forecastedCompletionDate: null, linkedAccounts: linked.map((a) => ({ id: a, displayName: a })), allocationAmountsByAccount: [] });
const goals = (o: { migrated: boolean; legacy?: any[]; savings?: any[] }) => ({ Goals: { migratedToSavingsGoals: o.migrated, goalsV2: o.legacy ?? [], savingsGoals: o.savings ?? [] } });

test('CreateGoal uses the savings model when the household has migrated', async () => {
  const f = installFakeMonarch({ ...goals({ migrated: true }), CreateSavingsGoals: { createSavingsGoals: { savingsGoals: [{ id: 's1', name: 'S', type: 'vacation' }] } } });
  const out = await run(CreateGoal, { name: 'S', type: 'vacation', target_amount: 500, target_date: '2027-01-01' });
  assert.equal(out.model, 'savings_goal');
  assert.deepEqual(f.byOp('CreateSavingsGoals')[0]!.variables, { input: { goals: [{ name: 'S', type: 'vacation', isSinkingFund: false, targetAmount: 500, targetDate: '2027-01-01' }] } });
});

test('CreateGoal falls back to the legacy model and notes unsupported fields', async () => {
  const f = installFakeMonarch({ ...goals({ migrated: false }), CreateGoalsV2: { createGoals: { goals: [{ id: 'g1', name: 'L', objective: 'savings' }], errors: null } } });
  const out = await run(CreateGoal, { name: 'L', target_date: '2027-01-01' });
  assert.equal(out.model, 'legacy');
  assert.match(out.note, /not supported/);
  assert.deepEqual(f.byOp('CreateGoalsV2')[0]!.variables, { input: { goals: [{ name: 'L', objective: 'savings' }] } });
});

test('UpdateGoal on a legacy goal links and unlinks through allocations', async () => {
  const f = installFakeMonarch({
    ...goals({ migrated: false, legacy: [legacyGoal('g1', 1)] }),
    UpdateGoalV2: { updateGoalV2: { goal: { id: 'g1' }, errors: null } },
    CreateAllocation: { createGoalAccountAllocation: { errors: null } },
    DeleteAllocation: { deleteGoalAccountAllocation: { errors: null } },
  });
  const out = await run(UpdateGoal, { goal_id: 'g1', name: 'L2', account_ids_to_link: ['x'], account_ids_to_unlink: ['a0'] });
  assert.equal(out.goal_id, 'g1');
  assert.deepEqual(f.byOp('UpdateGoalV2')[0]!.variables, { input: { id: 'g1', name: 'L2' } });
  assert.deepEqual(f.byOp('CreateAllocation')[0]!.variables, { input: { goalId: 'g1', accountId: 'x', useEntireAccountBalance: true } });
  assert.deepEqual(f.byOp('DeleteAllocation')[0]!.variables, { input: { goalId: 'g1', accountId: 'a0' } });
  await assert.rejects(run(UpdateGoal, { goal_id: 'nope', name: 'x' }), /not found/);
});

test('UpdateGoal on a savings goal sends one mutation', async () => {
  const f = installFakeMonarch({
    ...goals({ migrated: true, savings: [savingsGoal('s1')] }),
    UpdateSavingsGoal: { updateSavingsGoal: { savingsGoal: { ...savingsGoal('s1', ['x']), isSinkingFund: true }, errors: null } },
  });
  const out = await run(UpdateGoal, { goal_id: 's1', is_sinking_fund: true, account_ids_to_link: ['x'] });
  assert.deepEqual(out.linked_accounts, [{ account_id: 'x', name: 'x' }]);
  assert.deepEqual(f.byOp('UpdateSavingsGoal')[0]!.variables, { input: { id: 's1', isSinkingFund: true, accountIdsToLink: ['x'] } });
});

test('DeleteGoal refuses while accounts are linked', async () => {
  installFakeMonarch({ ...goals({ migrated: false, legacy: [legacyGoal('g1', 2)] }) });
  await assert.rejects(run(DeleteGoal, { goal_id: 'g1' }), /2 linked account/);
  installFakeMonarch({ ...goals({ migrated: true, savings: [savingsGoal('s1')] }), DeleteSavingsGoal: { deleteSavingsGoal: { success: true, errors: null } } });
  assert.deepEqual(await run(DeleteGoal, { goal_id: 's1' }), { deleted: true, goal_id: 's1' });
});

test('Contribute and Withdraw require the savings model', async () => {
  installFakeMonarch({ ...goals({ migrated: false, legacy: [legacyGoal('g1')] }) });
  await assert.rejects(run(ContributeToGoal, { goal_id: 'g1', account_id: 'a', amount: 1 }), /savings-goal model/);
  const f = installFakeMonarch({
    ...goals({ migrated: true, savings: [savingsGoal('s1')] }),
    Contribute: { createSavingsGoalContribution: { userNotice: null, goalEvent: { id: 'e1', goal: { id: 's1', currentBalance: 1, progress: 1, status: 'on_track' } } } },
    Withdraw: { createSavingsGoalWithdrawal: { goalEvent: { id: 'e2', goal: { id: 's1', currentBalance: 0, progress: 0, status: null } } } },
  });
  assert.equal((await run(ContributeToGoal, { goal_id: 's1', account_id: 'a', amount: 1, date: '2026-09-01' })).event_id, 'e1');
  assert.deepEqual(f.byOp('Contribute')[0]!.variables, { input: { id: 's1', accountId: 'a', amount: 1, date: '2026-09-01' } });
  assert.equal((await run(WithdrawFromGoal, { goal_id: 's1', account_id: 'a', amount: 1 })).current_amount, 0);
});
