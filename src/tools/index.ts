// Every tool, in the official server's order. Write tools are exposed only
// when MONARCH_ENABLE_WRITES=1 so a deploy defaults to read-only.
import type { ToolDef } from './registry.ts';
import { GetAccounts } from './read/accounts.ts';
import { GetTransactions } from './read/transactions.ts';
import { GetCashFlow } from './read/cashflow.ts';
import { GetSpendingByCategory } from './read/spending.ts';
import { GetBudget } from './read/budget.ts';
import { GetGoals } from './read/goals.ts';
import { GetInvestments } from './read/investments.ts';
import { GetNetWorthHistory } from './read/net-worth.ts';
import { GetRealEstate } from './read/real-estate.ts';
import { GetRecurring } from './read/recurring.ts';
import { GetCategories } from './read/categories.ts';
import { GetHouseholdMembers, GetBusinesses } from './read/household.ts';
import { GetMerchants } from './read/merchants.ts';
import { ListRules } from './read/rules.ts';
import { GetCreditScoreHistory } from './read/credit.ts';
import { GetTags } from './read/tags.ts';
import { CreateTag, UpdateTag, DeleteTag } from './write/tags.ts';
import { CreateCategory, UpdateCategory, DeleteCategory } from './write/categories.ts';
import { CreateMerchant, UpdateMerchant, MergeMerchants } from './write/merchants.ts';
import { CreateRule, DeleteRule } from './write/rules.ts';

// Official order.
const readTools = [
  GetAccounts,
  GetTransactions,
  GetBudget,
  GetCashFlow,
  GetCategories,
  GetGoals,
  GetInvestments,
  GetMerchants,
  GetNetWorthHistory,
  GetRealEstate,
  GetRecurring,
  GetSpendingByCategory,
  GetTags,
  GetCreditScoreHistory,
  GetHouseholdMembers,
  GetBusinesses,
  ListRules,
] as unknown as ToolDef[];
const writeTools = [
  CreateTag,
  UpdateTag,
  DeleteTag,
  CreateCategory,
  UpdateCategory,
  DeleteCategory,
  CreateMerchant,
  UpdateMerchant,
  MergeMerchants,
  CreateRule,
  DeleteRule,
] as unknown as ToolDef[];

export const writesEnabled = process.env.MONARCH_ENABLE_WRITES === '1';
export const allTools: ToolDef[] = [...readTools, ...writeTools];
export const tools: ToolDef[] = writesEnabled ? allTools : readTools;

export function findTool(name: string): ToolDef | undefined {
  return tools.find((t) => t.name === name);
}
