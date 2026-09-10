import { z } from 'zod';
import { defineTool, isoDate, nullableList } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { HOLDINGS_Q, type HoldingsData } from '../../monarch/ops/investments.ts';
import { fetchAccounts, scopeIsNarrowed } from './accounts.ts';

export const GetInvestments = defineTool({
  name: 'GetInvestments',
  title: 'Investment holdings',
  description: `List the user's investment holdings with current values and period performance.

Holdings are always current — this tool cannot show past portfolio composition.
The date range only controls the period-over-period change shown for each
holding.`,
  readOnly: true,
  idempotent: true,
  input: {
    start_date: isoDate,
    end_date: isoDate,
    accounts: nullableList.describe('filter to specific account names (e.g. ["Fidelity Brokerage"]).'),
    ownership: z.string().optional().default('{}').describe('JSON shape — same as GetAccounts. Use scope="user" for "only my investments" type queries.'),
  },
  handler: async ({ start_date, end_date, accounts, ownership }) => {
    const c = await getMonarch();
    const input: Record<string, unknown> = { startDate: start_date, endDate: end_date };
    if (scopeIsNarrowed({ accounts, ownership })) {
      input.accountIds = (await fetchAccounts(c, { accounts, ownership, account_types: ['Investments'] })).map((a) => a.id);
    }
    const { portfolio } = await c.query<HoldingsData>(HOLDINGS_Q, { input });
    const p = portfolio.performance;
    return {
      start_date,
      end_date,
      summary: {
        total_value: p.totalValue,
        total_cost_basis: p.totalCostBasis,
        total_gain: p.totalChangeDollars,
        total_gain_percent: p.totalChangePercent,
        one_day_change: p.oneDayChangeDollars,
        one_day_change_percent: p.oneDayChangePercent,
      },
      holdings: portfolio.aggregateHoldings.edges
        .filter((e) => e !== null)
        .map(({ node: n }) => ({
          id: n.id,
          name: n.security?.name ?? n.holdings[0]?.name ?? null,
          ticker: n.security?.ticker ?? n.holdings[0]?.ticker ?? null,
          type: n.security?.typeDisplay ?? null,
          asset_class: n.security?.assetClass ?? null,
          quantity: n.quantity,
          price: n.security?.currentPrice ?? null,
          value: n.totalValue,
          cost_basis: n.costBasis,
          allocation_percent: n.allocationPercent,
          period_change: n.securityPriceChangeDollars,
          period_change_percent: n.securityPriceChangePercent,
          total_gain: n.totalGainLossDollars,
          total_gain_percent: n.totalGainLossPercent,
          accounts: n.holdings.map((h) => ({ account_id: h.account?.id ?? null, account: h.account?.displayName ?? null, quantity: h.quantity, value: h.value })),
        })),
    };
  },
});
