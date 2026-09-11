export interface Ref {
  id: string;
  name?: string;
  displayName?: string;
}
export interface Criterion {
  operator: string;
  value: string;
}
export interface RuleNode {
  id: string;
  order: number;
  lastAppliedAt: string | null;
  merchantCriteria: Criterion[] | null;
  merchantNameCriteria: Criterion[] | null;
  originalStatementCriteria: Criterion[] | null;
  amountCriteria: { isExpense: boolean; operator: string; value: number | null; valueRange: { lower: number | null; upper: number | null } | null } | null;
  categoryIds: string[] | null;
  categories: Ref[] | null;
  accountIds: string[] | null;
  accounts: Ref[] | null;
  setMerchantAction: Ref | null;
  setCategoryAction: Ref | null;
  addTagsAction: Ref[] | null;
  setHideFromReportsAction: boolean;
  markNeedsReviewAction: boolean;
  markReviewedAction: boolean;
  reviewStatusAction: string | null;
  needsReviewByUserAction: Ref | null;
  actionSetOwner: Ref | null;
  actionSetOwnerIsJoint: boolean;
  actionSetBusinessEntity: Ref | null;
}

export const LIST_RULES_Q = /* GraphQL */ `
  query ListRules {
    transactionRules {
      id order lastAppliedAt
      merchantCriteria { operator value }
      merchantNameCriteria { operator value }
      originalStatementCriteria { operator value }
      amountCriteria { isExpense operator value valueRange { lower upper } }
      categoryIds categories { id name }
      accountIds accounts { id displayName }
      setMerchantAction { id name }
      setCategoryAction { id name }
      addTagsAction { id name }
      setHideFromReportsAction markNeedsReviewAction markReviewedAction reviewStatusAction
      needsReviewByUserAction { id displayName }
      actionSetOwner { id displayName }
      actionSetOwnerIsJoint
      actionSetBusinessEntity { id name }
    }
  }`;
export interface RulesData {
  transactionRules: RuleNode[];
}

export const CREATE_RULE_Q = /* GraphQL */ `
  mutation CreateRule($input: CreateTransactionRuleInput!) {
    createTransactionRuleV2(input: $input) { errors { message fieldErrors { field messages } } }
  }`;
export const DELETE_RULE_Q = /* GraphQL */ `
  mutation DeleteRule($id: ID!) {
    deleteTransactionRule(id: $id) { deleted errors { message } }
  }`;
