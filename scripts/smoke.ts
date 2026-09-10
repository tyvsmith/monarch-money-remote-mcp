// Live, read-only smoke test of every read tool against the configured account.
// Usage: npm run smoke [-- ToolName ...]   (filters by substring)
import { tools } from '../src/tools/index.ts';

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const m0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
const prev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
const yearAgo = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), 1));

const cases: Array<[string, Record<string, unknown>]> = [
  ['GetAccounts', {}],
  ['GetAccounts', { account_types: ['Cash'] }],
  ['GetAccounts', { ownership: '{"scope":"user","user":"self"}' }],
  ['GetTransactions', { start_date: iso(prev), end_date: iso(today), limit: 3 }],
  ['GetTransactions', { start_date: iso(prev), end_date: iso(today), total_count_only: true }],
  ['GetTransactions', { start_date: iso(prev), end_date: iso(today), limit: 2, include_details: true, filters: '{"transaction_type":"Debit"}' }],
  ['GetBudget', { start_date: iso(m0), end_date: iso(m0), include_actuals: true }],
  ['GetCashFlow', { start_date: iso(prev), end_date: iso(today) }],
  ['GetCashFlow', { start_date: iso(prev), end_date: iso(today), base_query: '{"group_by_time":"month","group_by_entity":"category_group"}', post_aggregation: '{"group_by":["category_group"],"operation":"avg"}' }],
  ['GetCategories', {}],
  ['GetGoals', {}],
  ['GetInvestments', { start_date: iso(prev), end_date: iso(today) }],
  ['GetMerchants', { search: 'a', limit: 5 }],
  ['GetNetWorthHistory', { start_date: iso(prev) }],
  ['GetNetWorthHistory', { start_date: iso(yearAgo), include_account_breakdown: true, account_types: ['Cash'] }],
  ['GetRealEstate', {}],
  ['GetRecurring', {}],
  ['GetRecurring', { include_liabilities: false }],
  ['GetSpendingByCategory', { start_date: iso(prev), end_date: iso(today) }],
  ['GetSpendingByCategory', { start_date: iso(prev), end_date: iso(today), totals_and_categories_only: true }],
  ['GetTags', {}],
  ['GetCreditScoreHistory', { start_date: iso(yearAgo), end_date: iso(today) }],
  ['GetHouseholdMembers', {}],
  ['GetBusinesses', {}],
  ['ListRules', {}],
];

const only = process.argv.slice(2);
let failed = 0;
let skipped = 0;
for (const [name, args] of cases) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  const t = tools.find((x) => x.name === name);
  if (!t) { skipped++; continue; }
  if (!t.readOnly) throw new Error(`refusing to smoke a write tool: ${name}`);
  const started = Date.now();
  try {
    const r = await t.handler(args as never);
    const s = JSON.stringify(r);
    console.log(`OK   ${name} ${JSON.stringify(args)} -> ${s.length}B ${Date.now() - started}ms :: ${s.slice(0, 160)}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name} ${JSON.stringify(args)}: ${(e as Error).message.slice(0, 400)}`);
  }
}
console.log(failed ? `${failed} FAILED` : `all passed${skipped ? ` (${skipped} not registered yet)` : ''}`);
process.exit(failed ? 1 : 0);
