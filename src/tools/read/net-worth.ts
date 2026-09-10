import { z } from 'zod';
import { defineTool, isoDate } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { NET_WORTH_Q, ACCOUNT_SNAPSHOTS_Q, type NetWorthData, type AccountSnapshotsData } from '../../monarch/ops/snapshots.ts';
import { thinToWeekly } from '../lib/net-worth.ts';
import { accountScopeInput, accountTypeFilters, fetchAccounts, scopeIsNarrowed } from './accounts.ts';

export const GetNetWorthHistory = defineTool({
  name: 'GetNetWorthHistory',
  title: 'Net worth history',
  description: `Get the user's net worth over time, with optional per-account breakdown.

Returns dated readings of total net worth, total assets, and total liabilities.
For ranges over 60 days the readings are weekly; otherwise daily.`,
  readOnly: true,
  idempotent: true,
  input: {
    start_date: isoDate.describe('ISO date string (YYYY-MM-DD), inclusive.'),
    end_date: z.string().nullable().optional().describe('ISO date string. Defaults to today when omitted.'),
    ...accountScopeInput,
    include_account_breakdown: z
      .boolean()
      .optional()
      .default(false)
      .describe('when true, each reading also includes per-account balances and the response includes per-account changes over the period — useful for "what drove the change?" questions.'),
  },
  handler: async (a) => {
    const c = await getMonarch();
    const end = a.end_date ?? new Date().toISOString().slice(0, 10);
    const af = await accountTypeFilters(c, a);
    const narrowed = scopeIsNarrowed(a);
    const accounts = narrowed || a.include_account_breakdown ? await fetchAccounts(c, a) : [];
    if (narrowed) af.ids = accounts.map((x) => x.id);
    const d = await c.query<NetWorthData>(NET_WORTH_Q, {
      filters: { startDate: a.start_date, endDate: end, accountFilters: Object.keys(af).length ? af : null },
    });
    const readings = thinToWeekly(
      d.aggregateSnapshots.map((s) => ({ date: s.date, net_worth: s.balance, assets: s.assetsBalance ?? 0, liabilities: Math.abs(s.liabilitiesBalance ?? 0) })),
    );
    const first = readings[0];
    const last = readings.at(-1);
    const out: Record<string, unknown> = {
      start_date: a.start_date,
      end_date: end,
      granularity: readings.length && readings.length < d.aggregateSnapshots.length ? 'weekly' : 'daily',
      readings,
      change: first && last ? { net_worth: last.net_worth - first.net_worth, assets: last.assets - first.assets, liabilities: last.liabilities - first.liabilities } : null,
    };
    if (a.include_account_breakdown) {
      const active = accounts.filter((x) => !x.deactivatedAt);
      const histories = await Promise.all(active.map((acct) => c.query<AccountSnapshotsData>(ACCOUNT_SNAPSHOTS_Q, { accountId: acct.id })));
      const byDate = new Map(readings.map((r) => [r.date, {} as Record<string, number>]));
      const per: Array<{ account_id: string; name: string; start_balance: number; end_balance: number; change: number }> = [];
      active.forEach((acct, i) => {
        const s = histories[i]!.snapshotsForAccount.filter((p) => p.date >= a.start_date && p.date <= end);
        for (const p of s) {
          const row = byDate.get(p.date);
          if (row) row[acct.displayName] = p.signedBalance;
        }
        const sb = s[0]?.signedBalance ?? 0;
        const eb = s.at(-1)?.signedBalance ?? 0;
        per.push({ account_id: acct.id, name: acct.displayName, start_balance: sb, end_balance: eb, change: eb - sb });
      });
      out.readings = readings.map((r) => ({ ...r, accounts: byDate.get(r.date) }));
      out.account_changes = per.sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
    }
    return out;
  },
});
