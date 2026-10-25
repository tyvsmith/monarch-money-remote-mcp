import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeMonarch } from '../helpers/fake-monarch.ts';
import { CreateTag, UpdateTag, DeleteTag } from '../../src/tools/write/tags.ts';
import { CreateCategory, UpdateCategory, DeleteCategory } from '../../src/tools/write/categories.ts';
import { CreateMerchant, UpdateMerchant, MergeMerchants } from '../../src/tools/write/merchants.ts';
import { CreateRule, UpdateRule, DeleteRule } from '../../src/tools/write/rules.ts';
import { setMonarchClientForTests } from '../../src/monarch/session.ts';

afterEach(() => setMonarchClientForTests(null));
const run = <T>(tool: { handler: (a: never) => Promise<unknown> }, args: T) => tool.handler(args as never) as Promise<Record<string, any>>;

test('CreateTag sends name and color and returns the id', async () => {
  const f = installFakeMonarch({ CreateTag: { createTransactionTag: { tag: { id: 't1', name: 'x', color: '#abcdef', order: 0, transactionCount: 0 }, errors: null } } });
  assert.deepEqual(await run(CreateTag, { name: 'x', color: '#abcdef' }), { tag_id: 't1', name: 'x', color: '#abcdef' });
  assert.deepEqual(f.byOp('CreateTag')[0]!.variables, { input: { name: 'x', color: '#abcdef' } });
});

test('UpdateTag fills in unchanged fields from the current tag', async () => {
  const f = installFakeMonarch({
    GetTags: { householdTransactionTags: [{ id: 't1', name: 'old', color: '#111111', order: 0, transactionCount: 0 }] },
    UpdateTag: (v) => ({ updateTransactionTag: { tag: { id: 't1', ...(v.input as object) }, errors: null } }),
  });
  await run(UpdateTag, { tag_id: 't1', name: 'new' });
  assert.deepEqual(f.byOp('UpdateTag')[0]!.variables, { input: { id: 't1', name: 'new', color: '#111111' } });
  await assert.rejects(run(UpdateTag, { tag_id: 'nope' }), /not found/);
});

test('DeleteTag surfaces payload errors', async () => {
  installFakeMonarch({ DeleteTag: { deleteTransactionTag: { errors: [{ message: 'in use' }] } } });
  await assert.rejects(run(DeleteTag, { tag_id: 't1' }), /DeleteTag: in use/);
});

test('CreateCategory / UpdateCategory / DeleteCategory map to the mutation inputs', async () => {
  const f = installFakeMonarch({
    CreateCategory: { createCategory: { category: { id: 'c1', name: 'n', icon: '🏷️', group: { id: 'g', name: 'G' } }, errors: null } },
    UpdateCategory: { updateCategory: { category: { id: 'c1', name: 'n2', icon: '🧪', group: { id: 'g', name: 'G' } }, errors: null } },
    DeleteCategory: { deleteCategory: { deleted: true, errors: null } },
  });
  const created = await run(CreateCategory, { name: 'n', group_id: 'g' });
  assert.equal(created.category_id, 'c1');
  assert.deepEqual(f.byOp('CreateCategory')[0]!.variables, { input: { name: 'n', group: 'g', icon: '🏷️' } });
  await run(UpdateCategory, { category_id: 'c1', name: 'n2', icon: '🧪' });
  assert.deepEqual(f.byOp('UpdateCategory')[0]!.variables, { input: { id: 'c1', name: 'n2', icon: '🧪' } });
  assert.deepEqual(await run(DeleteCategory, { category_id: 'c1' }), { deleted: true, category_id: 'c1' });
});

test('CreateMerchant returns an existing id or a by-name hint', async () => {
  installFakeMonarch({ GetMerchants: { merchants: [{ id: 'm1', name: 'Costco', transactionCount: 3 }] } });
  assert.equal((await run(CreateMerchant, { name: 'costco ' })).merchant_id, 'm1');
  assert.equal((await run(CreateMerchant, { name: 'Nope' })).merchant_id, null);
});

test('MergeMerchants deletes each source into the target and rejects self-merge', async () => {
  const f = installFakeMonarch({
    GetMerchant: (v, n) => ({ merchant: { id: v.id, name: 'T', transactionCount: n, ruleCount: 0, canBeDeleted: false } }),
    DeleteMerchant: { deleteMerchant: { success: true } },
  });
  const out = await run(MergeMerchants, { source_merchant_ids: ['a', 'b'], target_merchant_id: 't' });
  assert.deepEqual(out.merged_merchant_ids, ['a', 'b']);
  assert.deepEqual(f.byOp('DeleteMerchant').map((c) => c.variables), [{ id: 'a', to: 't' }, { id: 'b', to: 't' }]);
  await assert.rejects(run(MergeMerchants, { source_merchant_ids: ['t'], target_merchant_id: 't' }), /must not be in/);
});

test('UpdateMerchant renames by id', async () => {
  const f = installFakeMonarch({ UpdateMerchant: { updateMerchant: { merchant: { id: 'm', name: 'New', transactionCount: 1 }, errors: null } } });
  assert.equal((await run(UpdateMerchant, { merchant_id: 'm', new_name: 'New' })).name, 'New');
  assert.deepEqual(f.byOp('UpdateMerchant')[0]!.variables, { input: { merchantId: 'm', name: 'New' } });
});

test('CreateRule builds criteria and actions and finds the new rule id by diffing', async () => {
  const rule = (id: string) => ({ id, order: 0, lastAppliedAt: null, merchantCriteria: [{ operator: 'contains', value: 'costco' }], merchantNameCriteria: null, originalStatementCriteria: null, amountCriteria: null, categoryIds: null, categories: null, accountIds: null, accounts: null, setMerchantAction: null, setCategoryAction: { id: 'c', name: 'C' }, addTagsAction: null, setHideFromReportsAction: false, markNeedsReviewAction: false, markReviewedAction: false, reviewStatusAction: null, needsReviewByUserAction: null, actionSetOwner: null, actionSetOwnerIsJoint: false, actionSetBusinessEntity: null });
  const f = installFakeMonarch({
    ListRules: (_v, n) => ({ transactionRules: n === 1 ? [rule('r1')] : [rule('r1'), rule('r2')] }),
    CreateRule: { createTransactionRuleV2: { errors: null } },
    GetMerchant: { merchant: { id: 'm', name: 'Costco', transactionCount: 1, ruleCount: 0, canBeDeleted: false } },
  });
  const out = await run(CreateRule, { merchant_names: ['Costco'], amount_min: 10, amount_max: 50, set_category_id: 'c', set_merchant_id: 'm', set_reviewed: true });
  assert.equal(out.rule_id, 'r2');
  assert.deepEqual(f.byOp('CreateRule')[0]!.variables, {
    input: {
      applyToExistingTransactions: false,
      merchantCriteria: [{ operator: 'contains', value: 'Costco' }],
      amountCriteria: { isExpense: true, operator: 'between', valueRange: { lower: 10, upper: 50 } },
      setMerchantAction: 'Costco',
      setCategoryAction: 'c',
      reviewStatusAction: 'reviewed',
    },
  });
  await assert.rejects(run(CreateRule, { merchant_names: ['x'] }), /at least one criteria and one action/);
  await assert.rejects(run(CreateRule, { merchant_names: ['x'], set_needs_review: true, set_reviewed: true }), /mutually exclusive/);
});

const baseRule = {
  id: 'r1', order: 0, lastAppliedAt: null,
  merchantCriteria: [{ operator: 'contains', value: 'costco' }], merchantNameCriteria: null, originalStatementCriteria: null,
  amountCriteria: { isExpense: true, operator: 'between', value: null, valueRange: { lower: 10, upper: 50 } },
  categoryIds: null, categories: null, accountIds: null, accounts: null,
  setMerchantAction: null, setCategoryAction: { id: 'c', name: 'C' }, addTagsAction: [{ id: 't1', name: 'T' }],
  setHideFromReportsAction: false, markNeedsReviewAction: false, markReviewedAction: false, reviewStatusAction: 'reviewed',
  needsReviewByUserAction: null, actionSetOwner: null, actionSetOwnerIsJoint: false, actionSetBusinessEntity: null,
};
const fullInput = {
  id: 'r1', applyToExistingTransactions: false,
  merchantCriteria: [{ operator: 'contains', value: 'costco' }], merchantNameCriteria: [], originalStatementCriteria: [],
  amountCriteria: { isExpense: true, operator: 'between', value: null, valueRange: { lower: 10, upper: 50 } },
  categoryIds: [], accountIds: [],
  setMerchantAction: null, setCategoryAction: 'c', addTagsAction: ['t1'], setHideFromReportsAction: false, reviewStatusAction: 'reviewed',
  needsReviewByUserAction: null, actionSetOwner: null, actionSetOwnerIsJoint: false, actionSetBusinessEntity: null,
};
const installRule = (rule = baseRule) =>
  installFakeMonarch({
    ListRules: { transactionRules: [rule] },
    UpdateRule: { updateTransactionRuleV2: { transactionRule: { id: 'r1' }, errors: null } },
    GetMerchant: { merchant: { id: 'm', name: 'Amazon', transactionCount: 1, ruleCount: 0, canBeDeleted: false } },
  });

test('UpdateRule merges the current rule with the edits and sends the full input', async () => {
  const f = installRule();
  const out = await run(UpdateRule, { rule_id: 'r1', merchant_names: ['Amazon', 'AMZN'], set_merchant_id: 'm', add_tag_ids: [] });
  assert.equal(out.rule_id, 'r1');
  assert.ok(out.rule);
  assert.deepEqual(f.byOp('UpdateRule')[0]!.variables, {
    input: { ...fullInput, merchantCriteria: [{ operator: 'contains', value: 'Amazon' }, { operator: 'contains', value: 'AMZN' }], setMerchantAction: 'Amazon', addTagsAction: [] },
  });
});

test('UpdateRule amount semantics: partial bound keeps the other, clear_amount removes or replaces', async () => {
  let f = installRule();
  await run(UpdateRule, { rule_id: 'r1', amount_max: 80 });
  assert.deepEqual(f.byOp('UpdateRule')[0]!.variables.input, { ...fullInput, amountCriteria: { isExpense: true, operator: 'between', valueRange: { lower: 10, upper: 80 } } });
  f = installRule();
  await run(UpdateRule, { rule_id: 'r1', clear_amount: true, amount_min: 5 });
  assert.deepEqual(f.byOp('UpdateRule')[0]!.variables.input, { ...fullInput, amountCriteria: { isExpense: true, operator: 'gt', value: 5 } });
  f = installRule();
  await run(UpdateRule, { rule_id: 'r1', clear_amount: true });
  assert.deepEqual(f.byOp('UpdateRule')[0]!.variables.input, { ...fullInput, amountCriteria: null });
  f = installRule({ ...baseRule, amountCriteria: { isExpense: false, operator: 'equals', value: 42, valueRange: null } });
  await run(UpdateRule, { rule_id: 'r1', amount_min: 1 });
  assert.deepEqual(f.byOp('UpdateRule')[0]!.variables.input.amountCriteria, { isExpense: false, operator: 'gt', value: 1 });
});

test('UpdateRule clears actions with "" / false and only clears a matching review status', async () => {
  let f = installRule();
  await run(UpdateRule, { rule_id: 'r1', set_category_id: '', set_needs_review: false });
  assert.deepEqual(f.byOp('UpdateRule')[0]!.variables.input, { ...fullInput, setCategoryAction: null });
  f = installRule();
  await run(UpdateRule, { rule_id: 'r1', set_reviewed: false, set_hide_from_reports: true });
  assert.deepEqual(f.byOp('UpdateRule')[0]!.variables.input, { ...fullInput, reviewStatusAction: null, setHideFromReportsAction: true });
  f = installRule();
  await run(UpdateRule, { rule_id: 'r1', set_needs_review: true });
  assert.equal(f.byOp('UpdateRule')[0]!.variables.input.reviewStatusAction, 'needs_review');
});

test('UpdateRule refuses to clear the last criterion or action, empty edits, and unknown rules', async () => {
  installRule();
  await assert.rejects(run(UpdateRule, { rule_id: 'r1', merchant_names: [], clear_amount: true }), /at least one criterion/);
  await assert.rejects(run(UpdateRule, { rule_id: 'r1', set_category_id: '', add_tag_ids: [], set_reviewed: false }), /at least one action/);
  await assert.rejects(run(UpdateRule, { rule_id: 'r1' }), /nothing to update/);
  installRule({ ...baseRule, setCategoryAction: null, addTagsAction: null, reviewStatusAction: null, actionSetOwnerIsJoint: true });
  await run(UpdateRule, { rule_id: 'r1', set_hide_from_reports: false });
  installRule();
  await assert.rejects(run(UpdateRule, { rule_id: 'nope', set_reviewed: true }), /not found/);
  await assert.rejects(run(UpdateRule, { rule_id: 'r1', set_needs_review: true, set_reviewed: true }), /cannot both be true/);
  installFakeMonarch({ ListRules: { transactionRules: [baseRule] }, UpdateRule: { updateTransactionRuleV2: { transactionRule: null, errors: [{ message: 'bad' }] } } });
  await assert.rejects(run(UpdateRule, { rule_id: 'r1', set_reviewed: true }), /UpdateRule: bad/);
});

test('DeleteRule verifies by listing because the API returns deleted:false', async () => {
  installFakeMonarch({ DeleteRule: { deleteTransactionRule: { deleted: false, errors: null } }, ListRules: { transactionRules: [] } });
  assert.deepEqual(await run(DeleteRule, { rule_id: 'r' }), { deleted: true, rule_id: 'r' });
});
