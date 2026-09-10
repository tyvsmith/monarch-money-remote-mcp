import { z } from 'zod';
import { businessEntitySet, defineTool, isoDate, jsonArg } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import type { MonarchClient } from '../../monarch/client.ts';
import { aggregatesQuery, type AggregatesData, type GroupByKey } from '../../monarch/ops/cashflow.ts';
import { baseQuerySchema, cashFlowFilterSchema, postAggSchema, postAggregate, ENTITY_TO_GRAPHQL } from '../lib/aggregates.ts';
import { resolveOwnershipSet } from '../lib/ownership.ts';

export async function cashFlowGraphqlFilter(
  c: MonarchClient,
  start: string,
  end: string,
  f: z.infer<typeof cashFlowFilterSchema>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { startDate: start, endDate: end, transactionVisibility: 'non_hidden_transactions_only' };
  if (f.accounts?.length) out.accounts = f.accounts;
  if (f.include_categories?.length) out.categories = f.include_categories;
  if (f.exclude_categories?.length) out.excludeCategories = f.exclude_categories;
  if (f.merchants?.length) out.merchants = f.merchants;
  if (f.tags?.length) out.tags = f.tags;
  if (f.is_untagged !== undefined) out.isUntagged = f.is_untagged;
  if (f.category_type) out.categoryType = f.category_type;
  if (f.search) out.search = f.search;
  const biz = businessEntitySet(f.business_entities, f.include_unassigned_business_entities);
  if (biz) out.businessEntitySet = biz;
  const own = await resolveOwnershipSet(c, f.ownership_setting);
  if (own) out.ownershipSet = own;
  return out;
}

export const GetCashFlow = defineTool({
  name: 'GetCashFlow',
  title: 'Cash flow query',
  description: `Run a flexible cash flow query over a date range with two-stage aggregation.

Stage 1 (\`base_query\`) buckets transactions by time and/or by an entity dimension.
Stage 2 (\`post_aggregation\`, optional) further reduces those buckets — averaging,
summing, counting, or selecting the top/bottom N per group.`,
  readOnly: true,
  idempotent: true,
  input: {
    start_date: isoDate.describe('ISO date string (YYYY-MM-DD), inclusive.'),
    end_date: isoDate.describe('ISO date string, inclusive.'),
    base_query: z
      .string()
      .optional()
      .default('{}')
      .describe(
        'JSON shape {"group_by_time": "day"|"week"|"month"|"quarter"|"year", "group_by_entity": "category"|"category_group"|"merchant"|"household_merchant"|"account"|"needs_review_by_user"|"business_entity"}. Both fields optional. Default "{}" means a single overall total.',
      ),
    filters: z
      .string()
      .optional()
      .default('{}')
      .describe(
        'JSON object with any of: accounts, include_categories, exclude_categories, merchants, business_entities, include_unassigned_business_entities, tags, is_untagged, category_type ("expense"|"income"|"transfer"), ownership_setting, search. Entity filters take IDs. All filters intersect (AND).',
      ),
    post_aggregation: z
      .string()
      .nullable()
      .optional()
      .describe('optional JSON {"group_by": [<dim>...], "operation": "sum"|"avg"|"max"|"min"|"count", "limit": <int for max/min>}.'),
  },
  handler: async (a) => {
    const c = await getMonarch();
    const bq = jsonArg(a.base_query, baseQuerySchema, 'base_query');
    const f = jsonArg(a.filters, cashFlowFilterSchema, 'filters');
    const groupBy: GroupByKey[] = [];
    if (bq.group_by_time) groupBy.push(bq.group_by_time);
    if (bq.group_by_entity) groupBy.push(ENTITY_TO_GRAPHQL[bq.group_by_entity] as GroupByKey);
    const filters = await cashFlowGraphqlFilter(c, a.start_date, a.end_date, f);
    const { aggregates } = await c.query<AggregatesData>(aggregatesQuery(groupBy), { filters, groupBy: groupBy.length ? groupBy : null });
    const buckets = aggregates.map((r) => ({
      ...(r.groupBy ?? {}),
      total: r.summary.sum,
      income: r.summary.sumIncome,
      expenses: r.summary.sumExpense,
      savings: r.summary.savings,
      savings_rate: r.summary.savingsRate,
      transaction_count: r.summary.count,
    }));
    if (!a.post_aggregation) return { start_date: a.start_date, end_date: a.end_date, group_by: groupBy, buckets };
    const spec = jsonArg(a.post_aggregation, postAggSchema, 'post_aggregation');
    return { start_date: a.start_date, end_date: a.end_date, group_by: groupBy, post_aggregation: spec, results: postAggregate(aggregates, spec) };
  },
});
