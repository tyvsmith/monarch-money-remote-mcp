import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allTools, tools, writesEnabled } from '../../src/tools/index.ts';

const OFFICIAL = [
  'GetAccounts', 'GetTransactions', 'GetBudget', 'GetCashFlow', 'GetCategories', 'GetGoals', 'GetInvestments', 'GetMerchants', 'GetNetWorthHistory',
  'GetRealEstate', 'GetRecurring', 'GetSpendingByCategory', 'GetTags', 'GetCreditScoreHistory', 'GetHouseholdMembers', 'GetBusinesses', 'ListRules',
  'CreateTag', 'UpdateTag', 'DeleteTag', 'CreateCategory', 'UpdateCategory', 'DeleteCategory', 'CreateMerchant', 'UpdateMerchant', 'MergeMerchants',
  'CreateRule', 'DeleteRule', 'CreateTransaction', 'UpdateTransaction', 'DeleteTransaction', 'BulkUpdateTransactions', 'BulkRecategorizeTransactions',
  'UpdateTransactionSplits', 'CreateGoal', 'UpdateGoal', 'DeleteGoal', 'ContributeToGoal', 'WithdrawFromGoal', 'UpdateAccountBalanceHistory', 'ReportIssue',
];

test('registry exposes exactly the official tool names', () => {
  assert.deepEqual([...allTools.map((t) => t.name)].sort(), [...OFFICIAL].sort());
  assert.equal(allTools.filter((t) => t.readOnly).length, 17);
  assert.equal(allTools.length, 41);
});

test('write tools are hidden unless MONARCH_ENABLE_WRITES=1', () => {
  assert.equal(writesEnabled, process.env.MONARCH_ENABLE_WRITES === '1');
  assert.equal(tools.length, writesEnabled ? 41 : 17);
});

test('every tool has a description and unique name', () => {
  const names = new Set<string>();
  for (const t of allTools) {
    assert.ok(t.description.trim().length > 0, t.name);
    assert.ok(!names.has(t.name), `duplicate ${t.name}`);
    names.add(t.name);
  }
});
