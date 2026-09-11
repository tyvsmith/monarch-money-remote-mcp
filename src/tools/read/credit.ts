import { defineTool, isoDate } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { CREDIT_SCORES_Q, type CreditScoresData } from '../../monarch/ops/snapshots.ts';

export function scoreCategory(score: number): string {
  if (score >= 800) return 'Excellent';
  if (score >= 740) return 'Great';
  if (score >= 670) return 'Good';
  if (score >= 580) return 'Fair';
  return 'Poor';
}

export const GetCreditScoreHistory = defineTool({
  name: 'GetCreditScoreHistory',
  title: 'Credit score history',
  description: `Get the user's credit score history over a date range.

Returns one reading per month for each household member who has connected a
credit report, including the score and the score category (Poor / Fair / Good /
Great / Excellent). Score factors are not available through this server.`,
  readOnly: true,
  idempotent: true,
  input: {
    start_date: isoDate.describe('ISO date string (YYYY-MM-DD), inclusive.'),
    end_date: isoDate.describe('ISO date string (YYYY-MM-DD), inclusive.'),
  },
  handler: async ({ start_date, end_date }) => {
    const c = await getMonarch();
    const d = await c.query<CreditScoresData>(CREDIT_SCORES_Q, { startDate: start_date, endDate: end_date });
    const byUser = new Map<string, { user_id: string; name: string; readings: Array<{ date: string; score: number; category: string }> }>();
    for (const s of d.creditScoreSnapshots ?? []) {
      const e = byUser.get(s.user.id) ?? { user_id: s.user.id, name: s.user.displayName, readings: [] };
      e.readings.push({ date: s.reportedDate, score: s.score, category: scoreCategory(s.score) });
      byUser.set(s.user.id, e);
    }
    return {
      members: [...byUser.values()].map((m) => ({ ...m, readings: m.readings.sort((a, b) => a.date.localeCompare(b.date)) })),
    };
  },
});
