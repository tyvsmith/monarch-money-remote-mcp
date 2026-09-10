interface Amt {
  month: string;
  plannedAmount: number | null;
  actualAmount: number | null;
  remainingAmount: number | null;
  previousMonthRolloverAmount?: number | null;
  rolloverType?: string | null;
}
interface Tot {
  plannedAmount: number | null;
  actualAmount: number | null;
  remainingAmount: number | null;
}
export type BudgetMonthlyAmount = Amt;

export const BUDGET_Q = /* GraphQL */ `
  query Budget($startMonth: Date!, $endMonth: Date!) {
    budgetSystem
    budgetData(startMonth: $startMonth, endMonth: $endMonth) {
      monthlyAmountsByCategory {
        category { id name group { id name type } }
        monthlyAmounts { month plannedAmount actualAmount remainingAmount previousMonthRolloverAmount rolloverType }
      }
      monthlyAmountsByCategoryGroup {
        categoryGroup { id name type groupLevelBudgetingEnabled }
        monthlyAmounts { month plannedAmount actualAmount remainingAmount }
      }
      monthlyAmountsForFlexExpense {
        budgetVariability
        monthlyAmounts { month plannedAmount actualAmount remainingAmount }
      }
      totalsByMonth {
        month
        totalIncome { plannedAmount actualAmount remainingAmount }
        totalExpenses { plannedAmount actualAmount remainingAmount }
        totalFixedExpenses { plannedAmount actualAmount remainingAmount }
        totalFlexibleExpenses { plannedAmount actualAmount remainingAmount }
        totalNonMonthlyExpenses { plannedAmount actualAmount remainingAmount }
      }
    }
  }`;
export interface BudgetData {
  budgetSystem: string;
  budgetData: {
    monthlyAmountsByCategory: Array<{ category: { id: string; name: string; group: { id: string; name: string; type: string } }; monthlyAmounts: Amt[] }>;
    monthlyAmountsByCategoryGroup: Array<{ categoryGroup: { id: string; name: string; type: string; groupLevelBudgetingEnabled: boolean | null }; monthlyAmounts: Amt[] }>;
    monthlyAmountsForFlexExpense: { budgetVariability: string; monthlyAmounts: Amt[] };
    totalsByMonth: Array<{ month: string; totalIncome: Tot; totalExpenses: Tot; totalFixedExpenses: Tot; totalFlexibleExpenses: Tot; totalNonMonthlyExpenses: Tot }>;
  };
}
