import { z } from 'zod';
import { defineTool, nullableList, optBool, optNum, optStr, ToolInputError } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { assertNoPayloadErrors, type PayloadError } from '../lib/mutations.ts';
import { merchantNameFor } from '../lib/merchants.ts';
import { CREATE_RULE_Q, DELETE_RULE_Q, LIST_RULES_Q, UPDATE_RULE_Q, type Criterion, type RuleNode, type RulesData } from '../../monarch/ops/rules.ts';
import { shapeRule } from '../read/rules.ts';

export const CreateRule = defineTool({
  name: 'CreateRule',
  title: 'Create rule',
  description: `Create a transaction rule. At least one criteria AND one action is required.

Criteria (when do we match?): merchant_names, category_ids, account_ids, amount_min,
amount_max. \`merchant_names\` are literal text patterns matched against a transaction's
merchant name (not entity references); \`category_ids\`/\`account_ids\` are IDs from the read
tools.

Actions (what do we do?): set_merchant_id (or set_merchant_name), set_category_id, add_tag_ids,
set_hide_from_reports, set_needs_review, set_reviewed. set_needs_review and set_reviewed are
mutually exclusive.

New rules only affect future transactions. There is no MCP tool to apply a rule
retroactively — a too-wide rule applied across history is the kind of mistake that's
very hard to undo. After creating the rule, tell the user that to apply it to existing
transactions, they should open Monarch in a browser and run the rule from the rule's
detail page.`,
  readOnly: false,
  destructive: false,
  input: {
    merchant_names: nullableList,
    category_ids: nullableList,
    account_ids: nullableList,
    amount_min: optNum,
    amount_max: optNum,
    set_merchant_id: optStr,
    set_merchant_name: optStr,
    set_category_id: optStr,
    add_tag_ids: nullableList,
    set_hide_from_reports: optBool,
    set_needs_review: optBool,
    set_reviewed: optBool,
  },
  handler: async (a) => {
    if (a.set_needs_review && a.set_reviewed) throw new ToolInputError('set_needs_review and set_reviewed are mutually exclusive');
    const c = await getMonarch();
    const input: Record<string, unknown> = { applyToExistingTransactions: false };
    let criteria = 0;
    let actions = 0;
    if (a.merchant_names?.length) {
      input.merchantCriteria = a.merchant_names.map((v) => ({ operator: 'contains', value: v }));
      criteria++;
    }
    if (a.category_ids?.length) { input.categoryIds = a.category_ids; criteria++; }
    if (a.account_ids?.length) { input.accountIds = a.account_ids; criteria++; }
    if (a.amount_min != null || a.amount_max != null) {
      criteria++;
      input.amountCriteria =
        a.amount_min != null && a.amount_max != null
          ? { isExpense: true, operator: 'between', valueRange: { lower: a.amount_min, upper: a.amount_max } }
          : a.amount_min != null
            ? { isExpense: true, operator: 'gt', value: a.amount_min }
            : { isExpense: true, operator: 'lt', value: a.amount_max };
    }
    if (a.set_merchant_id || a.set_merchant_name) {
      input.setMerchantAction = await merchantNameFor(c, { merchant_id: a.set_merchant_id, merchant_name: a.set_merchant_name });
      actions++;
    }
    if (a.set_category_id) { input.setCategoryAction = a.set_category_id; actions++; }
    if (a.add_tag_ids?.length) { input.addTagsAction = a.add_tag_ids; actions++; }
    if (a.set_hide_from_reports != null) { input.setHideFromReportsAction = a.set_hide_from_reports; actions++; }
    if (a.set_needs_review) { input.reviewStatusAction = 'needs_review'; actions++; }
    if (a.set_reviewed) { input.reviewStatusAction = 'reviewed'; actions++; }
    if (!criteria || !actions) throw new ToolInputError('at least one criteria and one action are required');

    // The mutation returns no rule; diff the list to find the new id.
    const before = new Set((await c.query<RulesData>(LIST_RULES_Q)).transactionRules.map((r) => r.id));
    const d = await c.query<{ createTransactionRuleV2: { errors: PayloadError[] | null } }>(CREATE_RULE_Q, { input });
    assertNoPayloadErrors(d.createTransactionRuleV2, 'CreateRule');
    const created = (await c.query<RulesData>(LIST_RULES_Q)).transactionRules.find((r) => !before.has(r.id));
    return {
      rule_id: created?.id ?? null,
      rule: created ? shapeRule(created) : null,
      note: 'New rules only affect future transactions. To apply to existing ones, run the rule from its detail page in Monarch.',
    };
  },
});

type AmountBounds = { lower: number | null; upper: number | null };

/** Current rule's amount bounds; an exact-amount rule has none (it is replaced on edit). */
function currentBounds(r: RuleNode): AmountBounds {
  const a = r.amountCriteria;
  if (!a) return { lower: null, upper: null };
  if (a.valueRange) return { lower: a.valueRange.lower, upper: a.valueRange.upper };
  if (a.operator === 'gt' || a.operator === 'gte') return { lower: a.value, upper: null };
  if (a.operator === 'lt' || a.operator === 'lte') return { lower: null, upper: a.value };
  return { lower: null, upper: null };
}

type AmountInput = { isExpense: boolean; operator: string; value?: number | null; valueRange?: { lower: number | null; upper: number | null } | null };

function amountCriteria(isExpense: boolean, b: AmountBounds): AmountInput | null {
  if (b.lower != null && b.upper != null) return { isExpense, operator: 'between', valueRange: { lower: b.lower, upper: b.upper } };
  if (b.lower != null) return { isExpense, operator: 'gt', value: b.lower };
  if (b.upper != null) return { isExpense, operator: 'lt', value: b.upper };
  return null;
}

const plain = (cs: Criterion[] | null | undefined) => (cs ?? []).map((c) => ({ operator: c.operator, value: c.value }));
const currentReviewAction = (r: RuleNode) => r.reviewStatusAction ?? (r.markNeedsReviewAction ? 'needs_review' : r.markReviewedAction ? 'reviewed' : null);
const supplied = <T>(v: T | null | undefined): v is T => v !== undefined && v !== null;

export const UpdateRule = defineTool({
  name: 'UpdateRule',
  title: 'Update rule',
  description: `Update a transaction rule. Use ListRules first to find its rule_id. Only supplied params change.

\`merchant_names\` replaces every existing merchant-name criterion on the rule (ListRules
reports them merged under \`criteria.merchant_names\`), so pass the full list you want kept.
Pass [] to clear merchant_names, category_ids, account_ids, or add_tag_ids; pass "" to clear
set_merchant_id or set_category_id; pass False to clear set_hide_from_reports. Pass
set_needs_review=False or set_reviewed=False to clear only a matching current review status;
those two flags cannot both be True. Passing only amount_min or only amount_max keeps the
rule's other existing bound (an exact-amount rule is replaced). Use clear_amount=True alone to
remove amount criteria, or with bounds to set exactly those bounds (e.g. drop a max). Amount
bounds keep the rule's existing income/expense direction. Clearing the last criterion or action
is not allowed.

Goal links, ownership, business entity, splits, and notifications are not exposed here and are kept.
Edits only affect future transactions; transactions the rule already changed are not updated or
reverted. There is no MCP tool to re-apply a rule retroactively. After updating the rule, tell
the user that to apply it to existing transactions, they should open Monarch in a browser and
run the rule from the rule's detail page.`,
  readOnly: false,
  destructive: false,
  idempotent: true,
  input: {
    rule_id: z.string(),
    merchant_names: nullableList,
    category_ids: nullableList,
    account_ids: nullableList,
    amount_min: optNum,
    amount_max: optNum,
    set_merchant_id: optStr,
    set_merchant_name: optStr,
    set_category_id: optStr,
    add_tag_ids: nullableList,
    set_hide_from_reports: optBool,
    set_needs_review: optBool,
    set_reviewed: optBool,
    clear_amount: z.boolean().optional().default(false),
  },
  handler: async (a) => {
    if (a.set_needs_review && a.set_reviewed) throw new ToolInputError('set_needs_review and set_reviewed cannot both be true');
    const edits = (['merchant_names', 'category_ids', 'account_ids', 'amount_min', 'amount_max', 'set_merchant_id', 'set_merchant_name', 'set_category_id', 'add_tag_ids', 'set_hide_from_reports', 'set_needs_review', 'set_reviewed'] as const).filter((k) => supplied(a[k]));
    if (!edits.length && !a.clear_amount) throw new ToolInputError('nothing to update: supply at least one field');
    const c = await getMonarch();
    const current = (await c.query<RulesData>(LIST_RULES_Q)).transactionRules.find((r) => r.id === a.rule_id);
    if (!current) throw new ToolInputError(`rule ${a.rule_id} not found`);

    // Send the full set of fields this tool can read back, merged with the edits, so the
    // mutation behaves the same whether Monarch treats the input as a patch or a replacement.
    // Fields we cannot read (goal links, splits, notifications, criteria owner/business) are omitted and kept.
    const merchantCriteria = supplied(a.merchant_names) ? a.merchant_names.map((v) => ({ operator: 'contains', value: v })) : plain(current.merchantCriteria);
    const merchantNameCriteria = supplied(a.merchant_names) ? [] : plain(current.merchantNameCriteria);
    const originalStatementCriteria = plain(current.originalStatementCriteria);
    const categoryIds = supplied(a.category_ids) ? a.category_ids : (current.categoryIds ?? []);
    const accountIds = supplied(a.account_ids) ? a.account_ids : (current.accountIds ?? []);

    let amount: AmountInput | null = current.amountCriteria ? { isExpense: current.amountCriteria.isExpense, operator: current.amountCriteria.operator, value: current.amountCriteria.value, valueRange: current.amountCriteria.valueRange } : null;
    const boundsSupplied = supplied(a.amount_min) || supplied(a.amount_max);
    if (a.clear_amount && !boundsSupplied) amount = null;
    else if (boundsSupplied) {
      const base = a.clear_amount ? { lower: null, upper: null } : currentBounds(current);
      amount = amountCriteria(current.amountCriteria?.isExpense ?? true, { lower: a.amount_min ?? base.lower, upper: a.amount_max ?? base.upper });
    }

    let setMerchantAction: string | null = current.setMerchantAction?.name ?? null;
    if (supplied(a.set_merchant_id) || supplied(a.set_merchant_name)) {
      setMerchantAction = a.set_merchant_id === '' && !a.set_merchant_name ? null : await merchantNameFor(c, { merchant_id: a.set_merchant_id, merchant_name: a.set_merchant_name });
    }
    const setCategoryAction = supplied(a.set_category_id) ? (a.set_category_id || null) : (current.setCategoryAction?.id ?? null);
    const addTagsAction = supplied(a.add_tag_ids) ? a.add_tag_ids : (current.addTagsAction ?? []).map((t) => t.id);
    const setHideFromReportsAction = supplied(a.set_hide_from_reports) ? a.set_hide_from_reports : current.setHideFromReportsAction;
    let reviewStatusAction = currentReviewAction(current);
    if (a.set_needs_review) reviewStatusAction = 'needs_review';
    else if (a.set_reviewed) reviewStatusAction = 'reviewed';
    else if (a.set_needs_review === false && reviewStatusAction === 'needs_review') reviewStatusAction = null;
    else if (a.set_reviewed === false && reviewStatusAction === 'reviewed') reviewStatusAction = null;

    const criteria = [merchantCriteria.length + merchantNameCriteria.length, originalStatementCriteria.length, categoryIds.length, accountIds.length, amount ? 1 : 0].filter(Boolean).length;
    const actions = [setMerchantAction, setCategoryAction, addTagsAction.length, setHideFromReportsAction, reviewStatusAction, current.needsReviewByUserAction, current.actionSetOwner, current.actionSetOwnerIsJoint, current.actionSetBusinessEntity].filter(Boolean).length;
    if (!criteria) throw new ToolInputError('a rule must keep at least one criterion');
    if (!actions) throw new ToolInputError('a rule must keep at least one action');

    const input = {
      id: a.rule_id,
      applyToExistingTransactions: false,
      merchantCriteria,
      merchantNameCriteria,
      originalStatementCriteria,
      amountCriteria: amount,
      categoryIds,
      accountIds,
      setMerchantAction,
      setCategoryAction,
      addTagsAction,
      setHideFromReportsAction,
      reviewStatusAction,
      needsReviewByUserAction: current.needsReviewByUserAction?.id ?? null,
      actionSetOwner: current.actionSetOwner?.id ?? null,
      actionSetOwnerIsJoint: current.actionSetOwnerIsJoint,
      actionSetBusinessEntity: current.actionSetBusinessEntity?.id ?? null,
    };
    const d = await c.query<{ updateTransactionRuleV2: { transactionRule: { id: string } | null; errors: PayloadError[] | null } }>(UPDATE_RULE_Q, { input });
    assertNoPayloadErrors(d.updateTransactionRuleV2, 'UpdateRule');
    const updated = (await c.query<RulesData>(LIST_RULES_Q)).transactionRules.find((r) => r.id === a.rule_id);
    return {
      rule_id: a.rule_id,
      rule: updated ? shapeRule(updated) : null,
      note: 'Edits only affect future transactions. To apply to existing ones, run the rule from its detail page in Monarch.',
    };
  },
});

export const DeleteRule = defineTool({
  name: 'DeleteRule',
  title: 'Delete rule',
  description: 'Delete a transaction rule. Use ListRules first to find the rule_id.',
  readOnly: false,
  destructive: true,
  input: { rule_id: z.string() },
  handler: async ({ rule_id }) => {
    const c = await getMonarch();
    const d = await c.query<{ deleteTransactionRule: { deleted: boolean | null; errors: PayloadError[] | null } }>(DELETE_RULE_Q, { id: rule_id });
    assertNoPayloadErrors(d.deleteTransactionRule, 'DeleteRule');
    // Monarch returns deleted:false even on success; verify by listing.
    const still = (await c.query<RulesData>(LIST_RULES_Q)).transactionRules.some((r) => r.id === rule_id);
    if (still) throw new Error(`rule ${rule_id} still exists after delete`);
    return { deleted: true, rule_id };
  },
});
