import { defineTool } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { GET_CATEGORIES_Q, type CategoryGroupData } from '../../monarch/ops/categories.ts';

export const GetCategories = defineTool({
  name: 'GetCategories',
  title: 'List categories',
  description: `List all of the user's spending categories and the groups they belong to.

Returns the full set of categories the household has set up — including unused,
disabled, and budget-excluded ones. Each category and group includes a stable
\`id\` plus its group, type (income / expense / transfer), budget variability
(fixed / flexible / non-monthly), and whether unused budget rolls over.

Use this to discover categories before filtering other tools by category, or
when the user asks "what categories do I have?". Pass a category \`id\` (or a group
\`id\`) to the write tools that take \`category_id\` / \`group_id\`.`,
  readOnly: true,
  idempotent: true,
  input: {},
  handler: async () => {
    const c = await getMonarch();
    const { categoryGroups } = await c.query<CategoryGroupData>(GET_CATEGORIES_Q);
    return {
      groups: categoryGroups.map((g) => ({
        id: g.id,
        name: g.name,
        type: g.type,
        budget_variability: g.budgetVariability,
        rollover: g.rolloverPeriod !== null,
        group_level_budgeting: g.groupLevelBudgetingEnabled ?? false,
        categories: g.categories.map((k) => ({
          id: k.id,
          name: k.name,
          icon: k.icon,
          type: g.type,
          group_id: g.id,
          group_name: g.name,
          is_system: k.isSystemCategory,
          is_disabled: k.isDisabled,
          excluded_from_budget: k.excludeFromBudget ?? false,
          budget_variability: k.budgetVariability,
          rollover: k.rolloverPeriod !== null,
          transaction_count: k.transactionsCount,
        })),
      })),
    };
  },
});
