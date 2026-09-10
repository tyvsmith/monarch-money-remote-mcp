// `aggregates` fails server-side when the selection names a groupBy dimension
// that was not requested, and when summary.sumTransfer is selected. The query
// is therefore built per request from the groupBy list.
export const GROUP_BY_SELECTION = {
  day: 'day',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
  category: 'category { id name group { id name type } }',
  categoryGroup: 'categoryGroup { id name type }',
  merchant: 'merchant { id name }',
  householdMerchant: 'householdMerchant { id name }',
  account: 'account { id displayName }',
  needsReviewByUser: 'needsReviewByUser { id displayName }',
  businessEntity: 'businessEntity { id name }',
} as const;
export type GroupByKey = keyof typeof GROUP_BY_SELECTION;

export function aggregatesQuery(groupBy: readonly GroupByKey[]): string {
  const sel = groupBy.map((g) => GROUP_BY_SELECTION[g]).join(' ');
  return /* GraphQL */ `
  query Aggregates($filters: TransactionFilterInput, $groupBy: [String]) {
    aggregates(filters: $filters, groupBy: $groupBy, fillEmptyValues: true) {
      ${sel ? `groupBy { ${sel} }` : ''}
      summary { sum sumIncome sumExpense savings savingsRate count avg avgExpense avgIncome largest first last }
    }
  }`;
}
// Static variants so check-ops validates the template shapes offline.
export const AGGREGATES_TOTAL_Q = aggregatesQuery([]);
export const AGGREGATES_ALL_DIMENSIONS_Q = aggregatesQuery(Object.keys(GROUP_BY_SELECTION) as GroupByKey[]);

export interface AggregateSummary {
  sum: number;
  sumIncome: number;
  sumExpense: number;
  savings: number;
  savingsRate: number;
  count: number;
  avg: number | null;
  avgExpense: number | null;
  avgIncome: number | null;
  largest: number;
  first: string | null;
  last: string | null;
}
export interface AggregateRow {
  groupBy?: Record<string, unknown>;
  summary: AggregateSummary;
}
export interface AggregatesData {
  aggregates: AggregateRow[];
}
