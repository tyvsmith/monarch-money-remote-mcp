export interface RolloverPeriod {
  id: string;
  type: string;
  startMonth: string;
}
export interface CategoryNode {
  id: string;
  name: string;
  icon: string;
  order: number;
  isDisabled: boolean;
  isSystemCategory: boolean;
  excludeFromBudget: boolean | null;
  budgetVariability: string | null;
  transactionsCount: number;
  rolloverPeriod: RolloverPeriod | null;
}
export interface CategoryGroupNode {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  order: number;
  budgetVariability: string | null;
  groupLevelBudgetingEnabled: boolean | null;
  rolloverPeriod: RolloverPeriod | null;
  categories: CategoryNode[];
}

export const GET_CATEGORIES_Q = /* GraphQL */ `
  query GetCategories {
    categoryGroups {
      id name type order budgetVariability groupLevelBudgetingEnabled
      rolloverPeriod { id type startMonth }
      categories(includeDisabledSystemCategories: true) {
        id name icon order isDisabled isSystemCategory excludeFromBudget budgetVariability transactionsCount
        rolloverPeriod { id type startMonth }
      }
    }
  }`;
export interface CategoryGroupData {
  categoryGroups: CategoryGroupNode[];
}

export const CREATE_CATEGORY_Q = /* GraphQL */ `
  mutation CreateCategory($input: CreateCategoryInput!) {
    createCategory(input: $input) {
      category { id name icon group { id name } }
      errors { message fieldErrors { field messages } }
    }
  }`;
export const UPDATE_CATEGORY_Q = /* GraphQL */ `
  mutation UpdateCategory($input: UpdateCategoryInput!) {
    updateCategory(input: $input) {
      category { id name icon group { id name } }
      errors { message fieldErrors { field messages } }
    }
  }`;
export const DELETE_CATEGORY_Q = /* GraphQL */ `
  mutation DeleteCategory($id: UUID!, $moveToCategoryId: UUID) {
    deleteCategory(id: $id, moveToCategoryId: $moveToCategoryId) {
      deleted
      errors { message fieldErrors { field messages } }
    }
  }`;
