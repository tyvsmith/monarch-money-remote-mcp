import { z } from 'zod';
import type { AggregateRow } from '../../monarch/ops/cashflow.ts';

export const baseQuerySchema = z.object({
  group_by_time: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
  group_by_entity: z
    .enum(['category', 'category_group', 'merchant', 'household_merchant', 'account', 'needs_review_by_user', 'business_entity'])
    .optional(),
});
export const postAggSchema = z.object({
  group_by: z.array(z.string()).default([]),
  operation: z.enum(['sum', 'avg', 'max', 'min', 'count']),
  limit: z.number().int().positive().optional(),
});
export const cashFlowFilterSchema = z.object({
  accounts: z.array(z.string()).optional(),
  include_categories: z.array(z.string()).optional(),
  exclude_categories: z.array(z.string()).optional(),
  merchants: z.array(z.string()).optional(),
  business_entities: z.array(z.string()).optional(),
  include_unassigned_business_entities: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  is_untagged: z.boolean().optional(),
  category_type: z.enum(['expense', 'income', 'transfer']).optional(),
  ownership_setting: z.string().optional(),
  search: z.string().optional(),
});

export const ENTITY_TO_GRAPHQL: Record<string, string> = {
  category: 'category',
  category_group: 'categoryGroup',
  merchant: 'merchant',
  household_merchant: 'householdMerchant',
  account: 'account',
  needs_review_by_user: 'needsReviewByUser',
  business_entity: 'businessEntity',
};
const TIME_KEYS = ['day', 'week', 'month', 'quarter', 'year'];

export function timeKey(groupBy: Record<string, unknown> | undefined): string | null {
  for (const k of TIME_KEYS) if (groupBy && groupBy[k] != null) return k;
  return null;
}

export interface PostAggRow {
  group: Record<string, unknown>;
  value: number;
  count: number;
}

/** Second-stage reduction over first-stage buckets. `group_by` uses official dimension names. */
export function postAggregate(
  rows: AggregateRow[],
  spec: { group_by: string[]; operation: 'sum' | 'avg' | 'max' | 'min' | 'count'; limit?: number },
): PostAggRow[] {
  const dims = spec.group_by.map((d) => ENTITY_TO_GRAPHQL[d] ?? d);
  const buckets = new Map<string, { group: Record<string, unknown>; values: number[] }>();
  for (const r of rows) {
    const group: Record<string, unknown> = {};
    for (const d of dims) group[d] = r.groupBy?.[d];
    const key = JSON.stringify(
      dims.map((d) => {
        const v = group[d] as { id?: string } | string | undefined;
        return typeof v === 'object' && v ? v.id : v;
      }),
    );
    const b = buckets.get(key) ?? { group, values: [] };
    b.values.push(r.summary.sum);
    buckets.set(key, b);
  }
  let out: PostAggRow[] = [...buckets.values()].map((b) => {
    const n = b.values.length;
    const total = b.values.reduce((s, v) => s + v, 0);
    const value =
      spec.operation === 'count' ? n
      : spec.operation === 'sum' ? total
      : spec.operation === 'avg' ? total / n
      : spec.operation === 'max' ? Math.max(...b.values)
      : Math.min(...b.values);
    return { group: b.group, value, count: n };
  });
  if (spec.limit && (spec.operation === 'max' || spec.operation === 'min')) {
    out = out.sort((a, b) => (spec.operation === 'max' ? b.value - a.value : a.value - b.value)).slice(0, spec.limit);
  }
  return out;
}
