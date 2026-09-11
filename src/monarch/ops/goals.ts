// Two goal models coexist: legacy goalsV2 and the newer savingsGoals.
// migratedToSavingsGoals says which one the household uses for new goals.
export const GOALS_Q = /* GraphQL */ `
  query Goals {
    migratedToSavingsGoals
    goalsV2 {
      id name objective type targetAmount currentAmount completionPercent plannedMonthlyContribution
      estimatedCompletionMonth archivedAt completedAt priority
      accountAllocations { id currentAmount useEntireAccountBalance account { id displayName } }
    }
    savingsGoals {
      id name type targetAmount targetDate currentBalance progress status isSinkingFund isArchived
      contributionTotal withdrawalTotal rebalanceTotal spendingTotal netContribution
      estimatedMonthsUntilCompletion forecastedCompletionDate
      linkedAccounts { id displayName }
      allocationAmountsByAccount { account { id displayName } totalAmount contributionsAmount withdrawalsAmount adjustmentAmount spendingAmount }
    }
  }`;
export interface GoalV2 {
  id: string;
  name: string;
  objective: string;
  type: string;
  targetAmount: number | null;
  currentAmount: number | null;
  completionPercent: number | null;
  plannedMonthlyContribution: number | null;
  estimatedCompletionMonth: string | null;
  archivedAt: string | null;
  completedAt: string | null;
  priority: number;
  accountAllocations: Array<{ id: string; currentAmount: number | null; useEntireAccountBalance: boolean; account: { id: string; displayName: string } }>;
}
export interface SavingsGoal {
  id: string;
  name: string;
  type: string;
  targetAmount: number | null;
  targetDate: string | null;
  currentBalance: number;
  progress: number;
  status: string | null;
  isSinkingFund: boolean;
  isArchived: boolean | null;
  contributionTotal: number;
  withdrawalTotal: number;
  rebalanceTotal: number;
  spendingTotal: number;
  netContribution: number;
  estimatedMonthsUntilCompletion: number | null;
  forecastedCompletionDate: string | null;
  linkedAccounts: Array<{ id: string; displayName: string } | null>;
  allocationAmountsByAccount: Array<{
    account: { id: string; displayName: string };
    totalAmount: number | null;
    contributionsAmount: number | null;
    withdrawalsAmount: number | null;
    adjustmentAmount: number | null;
    spendingAmount: number | null;
  } | null> | null;
}
export interface GoalsData {
  migratedToSavingsGoals: boolean;
  goalsV2: GoalV2[];
  savingsGoals: SavingsGoal[];
}

const ERR = 'errors { message fieldErrors { field messages } }';
export const CREATE_SAVINGS_GOALS_Q = /* GraphQL */ `
  mutation CreateSavingsGoals($input: CreateSavingsGoalsInput!) {
    createSavingsGoals(input: $input) { savingsGoals { id name type } }
  }`;
export const UPDATE_SAVINGS_GOAL_Q = /* GraphQL */ `
  mutation UpdateSavingsGoal($input: UpdateSavingsGoalInput!) {
    updateSavingsGoal(input: $input) {
      savingsGoal { id name targetAmount targetDate currentBalance progress isSinkingFund linkedAccounts { id displayName } }
      ${ERR}
    }
  }`;
export const DELETE_SAVINGS_GOAL_Q = /* GraphQL */ `
  mutation DeleteSavingsGoal($input: DeleteSavingsGoalInput!) {
    deleteSavingsGoal(input: $input) { success errors { message } }
  }`;
export const CONTRIBUTE_Q = /* GraphQL */ `
  mutation Contribute($input: CreateSavingsGoalContributionInput!) {
    createSavingsGoalContribution(input: $input) { userNotice goalEvent { id goal { id currentBalance progress status } } }
  }`;
export const WITHDRAW_Q = /* GraphQL */ `
  mutation Withdraw($input: CreateSavingsGoalWithdrawalInput!) {
    createSavingsGoalWithdrawal(input: $input) { goalEvent { id goal { id currentBalance progress status } } }
  }`;
export const CREATE_GOALS_V2_Q = /* GraphQL */ `
  mutation CreateGoalsV2($input: CreateGoalsInput!) {
    createGoals(input: $input) { goals { id name objective } ${ERR} }
  }`;
export const UPDATE_GOAL_V2_Q = /* GraphQL */ `
  mutation UpdateGoalV2($input: UpdateGoalInput!) {
    updateGoalV2(input: $input) { goal { id name targetAmount } ${ERR} }
  }`;
export const DELETE_GOAL_V2_Q = /* GraphQL */ `
  mutation DeleteGoalV2($input: DeleteGoalInput!) {
    deleteGoalV2(input: $input) { success ${ERR} }
  }`;
export const CREATE_ALLOCATION_Q = /* GraphQL */ `
  mutation CreateAllocation($input: CreateGoalAccountAllocationInput!) {
    createGoalAccountAllocation(input: $input) { goalAccountAllocation { id } goal { id currentAmount } ${ERR} }
  }`;
export const DELETE_ALLOCATION_Q = /* GraphQL */ `
  mutation DeleteAllocation($input: DeleteGoalAccountAllocationInput!) {
    deleteGoalAccountAllocation(input: $input) { goal { id currentAmount } ${ERR} }
  }`;
