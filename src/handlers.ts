import { getMonarchClient } from './monarch-client.ts';
import * as overrides from './monarch-overrides.ts';

export type Verbosity = 'ultra-light' | 'light' | 'standard';

export interface DateRange {
  startDate?: string;
  endDate?: string;
}

export interface CashflowFilters {
  search?: string;
  categories?: string[];
  accounts?: string[];
  tags?: string[];
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface TransactionFilters extends DateRange {
  limit?: number;
  offset?: number;
  categoryIds?: string[];
  accountIds?: string[];
  tagIds?: string[];
  merchantIds?: string[];
  search?: string;
  isCredit?: boolean;
  absAmountRange?: [number?, number?];
}

export interface RecurringStreamFilters {
  accounts?: string[];
  categories?: string[];
  merchants?: string[];
}

export interface RecurringStreamOptions {
  includeLiabilities?: boolean;
  includePending?: boolean;
  filters?: RecurringStreamFilters;
}

// ----- accounts -----

export async function getAccounts(
  opts: { includeHidden?: boolean; verbosity?: Verbosity } = {},
) {
  const c = await getMonarchClient();
  return c.accounts.getAll(opts);
}

export async function getAccountById(id: string) {
  const c = await getMonarchClient();
  return c.accounts.getById(id);
}

export async function getAccountHistory(accountId: string, range: DateRange = {}) {
  const c = await getMonarchClient();
  return c.accounts.getHistory(accountId, range.startDate, range.endDate);
}

export async function getBalances(range: DateRange = {}) {
  const c = await getMonarchClient();
  return c.accounts.getBalances(range.startDate, range.endDate);
}

export async function getNetWorthHistory(range: DateRange = {}) {
  const c = await getMonarchClient();
  return c.accounts.getNetWorthHistory(range.startDate, range.endDate);
}

// ----- transactions -----

export async function getTransactions(filters: TransactionFilters = {}) {
  const c = await getMonarchClient();
  return c.transactions.getTransactions(filters);
}

export async function getTransactionDetails(id: string) {
  return overrides.getTransactionDetails(id);
}

export async function getTransactionsSummary() {
  return overrides.getTransactionsSummary();
}

export async function getMerchants(opts: { search?: string; limit?: number } = {}) {
  return overrides.getMerchants(opts);
}

// ----- budgets -----

export async function getBudgets(opts: DateRange & { categoryIds?: string[] } = {}) {
  const c = await getMonarchClient();
  return c.budgets.getBudgets(opts);
}

export async function getGoals() {
  return overrides.getGoals();
}

export async function getBills(
  opts: DateRange & { includeCompleted?: boolean; limit?: number } = {},
) {
  return overrides.getBills(opts);
}

// ----- cashflow -----

export async function getCashflow(
  opts: DateRange & { filters?: CashflowFilters } = {},
) {
  return overrides.getCashflow({ startDate: opts.startDate, endDate: opts.endDate });
}

export async function getCashflowSummary(
  opts: DateRange & { filters?: CashflowFilters } = {},
) {
  const c = await getMonarchClient();
  return c.cashflow.getCashflowSummary(opts);
}

// ----- recurring -----

export async function getRecurringStreams(opts: RecurringStreamOptions = {}) {
  const c = await getMonarchClient();
  return c.recurring.getRecurringStreams(opts);
}

export async function getUpcomingRecurring(
  range: { startDate: string; endDate: string; filters?: RecurringStreamFilters },
) {
  const c = await getMonarchClient();
  return c.recurring.getUpcomingRecurringItems(range);
}

// ----- categories / tags -----

export async function getCategories() {
  const c = await getMonarchClient();
  return c.categories.getCategories();
}

export async function getCategoryGroups() {
  return overrides.getCategoryGroups();
}

export async function getTags() {
  return overrides.getTags();
}

// ----- institutions -----

export async function getInstitutions() {
  const c = await getMonarchClient();
  return c.institutions.getInstitutions();
}

export async function getInstitutionSettings() {
  const c = await getMonarchClient();
  return c.institutions.getInstitutionSettings();
}

// ----- insights -----

export async function getInsights(
  _opts: DateRange & { insightTypes?: string[] } = {},
) {
  return overrides.getInsights();
}

export async function getCreditScore(_opts: { includeHistory?: boolean } = {}) {
  return overrides.getCreditScore();
}
