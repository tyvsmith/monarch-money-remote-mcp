import { z } from 'zod';
import { defineTool, nullableList, optBool, optNum, optStr, ToolInputError } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { assertNoPayloadErrors, type PayloadError } from '../lib/mutations.ts';
import { merchantNameFor } from '../lib/merchants.ts';
import { CREATE_RULE_Q, DELETE_RULE_Q, LIST_RULES_Q, type RulesData } from '../../monarch/ops/rules.ts';
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
