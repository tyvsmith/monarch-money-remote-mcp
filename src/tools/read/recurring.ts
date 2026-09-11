import { z } from 'zod';
import { defineTool } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { RECURRING_Q, type RecurringData } from '../../monarch/ops/recurring.ts';
import { bucketRecurring } from '../lib/recurring.ts';

export const GetRecurring = defineTool({
  name: 'GetRecurring',
  title: 'Recurring activity',
  description: `List the user's recurring activity — paychecks, bills, subscriptions, transfers.

Returns four buckets: recurring income, recurring expenses, credit-card bill
payments, and recurring transfers (transfers are excluded from expense totals).
Each item includes its name, amount, category, account, frequency, last paid
date, and next forecasted date.`,
  readOnly: true,
  idempotent: true,
  input: {
    include_liabilities: z
      .boolean()
      .optional()
      .default(true)
      .describe('include credit card bills and loan payments from connected credit reports. Set to false when the user is asking specifically about "subscriptions" — those are merchant-based (Netflix, Spotify, gym), not credit card bills.'),
    include_pending: z.boolean().optional().default(false).describe('include suspected/unconfirmed recurring items.'),
  },
  handler: async ({ include_liabilities, include_pending }) => {
    const c = await getMonarch();
    const d = await c.query<RecurringData>(RECURRING_Q, { includeLiabilities: include_liabilities ?? true, includePending: include_pending ?? false });
    return bucketRecurring(d.recurringTransactionStreams);
  },
});
