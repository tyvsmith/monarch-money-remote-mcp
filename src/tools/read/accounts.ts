import { z } from 'zod';
import { businessEntitySet, defineTool, nullableList } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import type { MonarchClient } from '../../monarch/client.ts';
import {
  GET_ACCOUNTS_Q,
  ACCOUNT_TYPES_Q,
  type Account,
  type AccountsData,
  type AccountTypesData,
} from '../../monarch/ops/accounts.ts';
import { resolveAccountTypeNames, resolveAccountSubtypeNames } from '../lib/account-types.ts';
import { parseOwnership, resolveOwnershipSet } from '../lib/ownership.ts';

export const accountScopeInput = {
  accounts: nullableList.describe('filter to specific account names.'),
  account_types: nullableList.describe(
    'filter by broad account TYPE display name (e.g. ["Cash", "Investments", "Credit Cards", "Loans", "Real Estate"]). Use this for broad questions; do NOT also pass account_sub_types.',
  ),
  account_sub_types: nullableList.describe(
    'filter by specific account SUBTYPE display name (e.g. ["Checking", "Savings", "401k", "Brokerage (Taxable)"]). Use this for specific questions; do NOT also pass account_types.',
  ),
  businesses: nullableList.describe('filter to accounts attached to one of these businesses (ids from GetBusinesses).'),
  include_unassigned_businesses: z
    .boolean()
    .optional()
    .default(false)
    .describe('when filtering by businesses, also include accounts not attached to any business.'),
  ownership: z
    .string()
    .optional()
    .default('{}')
    .describe(
      'JSON object describing whose accounts to include. Shape: {"scope": "household" | "user", "user": "self" | "<name>", "jointly_owned_setting": true | false | null}. Default "{}" means everyone in the household.',
    ),
};

export interface AccountScope {
  accounts?: string[] | null;
  account_types?: string[] | null;
  account_sub_types?: string[] | null;
  businesses?: string[] | null;
  include_unassigned_businesses?: boolean;
  ownership?: string;
}

/** True when the scope selects a subset of accounts by name, business, or owner (type filters aside). */
export function scopeIsNarrowed(scope: AccountScope): boolean {
  return !!(scope.accounts?.length || scope.businesses?.length || parseOwnership(scope.ownership).scope === 'user');
}

/** Resolve official display-name type filters to Monarch's internal names. Shared with GetNetWorthHistory. */
export async function accountTypeFilters(c: MonarchClient, scope: Pick<AccountScope, 'account_types' | 'account_sub_types'>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (!scope.account_types?.length && !scope.account_sub_types?.length) return out;
  const { accountTypes } = await c.query<AccountTypesData>(ACCOUNT_TYPES_Q);
  if (scope.account_types?.length) out.accountTypes = resolveAccountTypeNames(scope.account_types, accountTypes);
  if (scope.account_sub_types?.length) out.accountSubtypes = resolveAccountSubtypeNames(scope.account_sub_types, accountTypes);
  return out;
}

/** Shared by GetAccounts, GetNetWorthHistory, GetInvestments, GetRealEstate. */
export async function fetchAccounts(c: MonarchClient, scope: AccountScope, includeHidden = true): Promise<Account[]> {
  const filters: Record<string, unknown> = { includeHidden, ...(await accountTypeFilters(c, scope)) };
  const biz = businessEntitySet(scope.businesses, scope.include_unassigned_businesses);
  if (biz) filters.businessEntitySet = biz;
  const own = await resolveOwnershipSet(c, scope.ownership);
  if (own) filters.ownershipSet = own;
  let accounts = (await c.query<AccountsData>(GET_ACCOUNTS_Q, { filters })).accounts;
  if (scope.accounts?.length) {
    const names = new Set(scope.accounts.map((s) => s.toLowerCase()));
    accounts = accounts.filter((a) => names.has(a.displayName.toLowerCase()));
  }
  return accounts;
}

export function shapeAccount(a: Account) {
  return {
    id: a.id,
    name: a.displayName,
    notes: a.notes ?? undefined,
    type: a.type.display,
    sub_type: a.subtype.display,
    is_asset: a.isAsset,
    is_manual: a.isManual,
    is_hidden: a.isHidden,
    balance: a.displayBalance ?? 0,
    signed_balance: a.currentBalance ?? 0,
    mask: a.mask ?? undefined,
    institution: a.institution?.name,
    owner: a.ownedByUser?.displayName,
    business: a.businessEntity?.name,
    ...(a.type.name === 'loan'
      ? {
          apr: a.apr,
          minimum_payment: a.minimumPayment,
          interest_rate: a.interestRate,
          remaining_term: a.creditReportLiabilityAccount?.termsFrequency ?? null,
        }
      : {}),
    ...(a.type.name === 'credit' ? { credit_limit: a.limit } : {}),
    closed: a.deactivatedAt !== null,
  };
}

export const GetAccounts = defineTool({
  name: 'GetAccounts',
  title: 'List accounts',
  description: `List the user's connected accounts and their current balances.

Returns each account's id, name, notes (when set), type (e.g. Checking, Credit Card, 401k),
current balance, and — for loans — APR, minimum payment, and remaining term.
Also returns total assets, total liabilities, and net worth. Pass an account
\`id\` to the write tools that take \`account_id\`.`,
  readOnly: true,
  idempotent: true,
  input: accountScopeInput,
  handler: async (args) => {
    const c = await getMonarch();
    const accounts = (await fetchAccounts(c, args)).filter((a) => !a.deactivatedAt);
    const nw = accounts.filter((a) => a.includeInNetWorth);
    const total_assets = nw.filter((a) => a.isAsset).reduce((s, a) => s + (a.displayBalance ?? 0), 0);
    const total_liabilities = nw.filter((a) => !a.isAsset).reduce((s, a) => s + (a.displayBalance ?? 0), 0);
    return {
      accounts: accounts.map(shapeAccount),
      total_assets,
      total_liabilities,
      net_worth: total_assets - total_liabilities,
    };
  },
});
