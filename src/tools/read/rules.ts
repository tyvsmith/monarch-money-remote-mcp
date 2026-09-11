import { defineTool } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { LIST_RULES_Q, type Ref, type RuleNode, type RulesData } from '../../monarch/ops/rules.ts';

const ref = (r: Ref | null | undefined) => (r ? { id: r.id, name: r.name ?? r.displayName } : null);
const refs = (rs: Ref[] | null | undefined) => (rs ?? []).map((r) => ref(r)!);

export function shapeRule(r: RuleNode) {
  return {
    rule_id: r.id,
    order: r.order,
    last_applied_at: r.lastAppliedAt,
    criteria: {
      merchant_names: [...(r.merchantCriteria ?? []), ...(r.merchantNameCriteria ?? [])],
      original_statement: r.originalStatementCriteria ?? [],
      amount: r.amountCriteria
        ? { is_expense: r.amountCriteria.isExpense, operator: r.amountCriteria.operator, value: r.amountCriteria.value, range: r.amountCriteria.valueRange }
        : null,
      category_ids: r.categoryIds ?? [],
      categories: refs(r.categories),
      account_ids: r.accountIds ?? [],
      accounts: refs(r.accounts),
    },
    actions: {
      set_merchant: ref(r.setMerchantAction),
      set_merchant_id: r.setMerchantAction?.id ?? null,
      set_category: ref(r.setCategoryAction),
      set_category_id: r.setCategoryAction?.id ?? null,
      add_tags: refs(r.addTagsAction),
      add_tag_ids: (r.addTagsAction ?? []).map((t) => t.id),
      set_hide_from_reports: r.setHideFromReportsAction,
      set_needs_review: r.markNeedsReviewAction || r.reviewStatusAction === 'needs_review',
      set_reviewed: r.markReviewedAction || r.reviewStatusAction === 'reviewed',
      needs_review_by: ref(r.needsReviewByUserAction),
      set_owner: ref(r.actionSetOwner),
      set_owner_is_joint: r.actionSetOwnerIsJoint,
      set_business: ref(r.actionSetBusinessEntity),
    },
  };
}

export const ListRules = defineTool({
  name: 'ListRules',
  title: 'List transaction rules',
  description: `List the household's transaction rules.

Returns each rule's criteria (what it matches) and actions (what it does).
Category, account, tag, and merchant references include both their name and a
stable \`id\` (e.g. \`category_ids\`, \`set_category_id\`, \`add_tag_ids\`) to identify
the referenced entities.

Useful for discovering existing automation before suggesting a new rule, or
before deleting a rule by id.`,
  readOnly: true,
  idempotent: true,
  input: {},
  handler: async () => {
    const c = await getMonarch();
    const { transactionRules } = await c.query<RulesData>(LIST_RULES_Q);
    return { rules: transactionRules.map(shapeRule) };
  },
});
