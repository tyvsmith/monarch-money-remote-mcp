import { z } from 'zod';
import { defineTool, dryRun, isoDate, jsonArg, ToolInputError } from '../registry.ts';
import { getMonarch } from '../../monarch/session.ts';
import { GET_ACCOUNTS_Q, type AccountsData } from '../../monarch/ops/accounts.ts';
import { ACCOUNT_SNAPSHOTS_Q, type AccountSnapshotsData } from '../../monarch/ops/snapshots.ts';
import { PARSE_BALANCE_HISTORY_Q, UPLOAD_SESSION_Q, type UploadResponse, type UploadSession, type UploadSessionData } from '../../monarch/ops/balance-history.ts';
import { balancesToCsv, previewBalanceUpload } from '../lib/balance-history.ts';

const entries = z.array(z.object({ date: isoDate, balance: z.number() })).min(1);
const done = (s: UploadSession | null) => !!s && ['completed', 'errored'].includes(s.status.toLowerCase());

export const UpdateAccountBalanceHistory = defineTool({
  name: 'UpdateAccountBalanceHistory',
  title: 'Upload balance history',
  description: `Write balance history to a manual account, replacing the dates the entries cover.

Use this to upload historical balances for an account that does not sync from an institution
(e.g. balances fetched from an external API). Find the account id with GetAccounts; only manual
accounts can be written. To read existing history, use
GetNetWorthHistory(include_account_breakdown=true, accounts=[...]).

This server uploads through Monarch's CSV balance-history importer. Days with no entry carry
the previous balance forward; the account's current balance updates when the upload reaches
the most recent data point. UNVERIFIED against the live API: use dry_run first and try it on a
throwaway manual account before trusting it.`,
  readOnly: false,
  destructive: true,
  input: {
    account_id: z.string().describe('ID of a manual account (from GetAccounts).'),
    balances: z
      .string()
      .describe('JSON list of {"date": "YYYY-MM-DD", "balance": number} entries. Balance is signed the same way GetAccounts reports it: positive for assets, negative for amounts owed on liabilities. A single entry sets that one day\'s balance.'),
    dry_run: dryRun('date range, snapshots to write, existing snapshots that would be replaced, whether the current balance would change'),
  },
  handler: async ({ account_id, balances, dry_run }) => {
    const c = await getMonarch();
    const list = jsonArg(balances, entries, 'balances');
    const acct = (await c.query<AccountsData>(GET_ACCOUNTS_Q, { filters: { includeHidden: true, ids: [account_id] } })).accounts[0];
    if (!acct) throw new ToolInputError(`account ${account_id} not found`);
    if (!acct.isManual) throw new ToolInputError(`account ${acct.displayName} syncs from an institution; only manual accounts can be written`);
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const history = (await c.query<AccountSnapshotsData>(ACCOUNT_SNAPSHOTS_Q, { accountId: account_id })).snapshotsForAccount;
    const existing = history.map((s) => ({ date: s.date, balance: s.signedBalance }));
    const preview = previewBalanceUpload(existing, sorted, acct.currentBalance ?? 0, new Date().toISOString().slice(0, 10));
    if (dry_run) return { dry_run: true, account_id, account: acct.displayName, ...preview };

    const form = new FormData();
    form.append('files', new Blob([balancesToCsv(sorted)], { type: 'text/csv' }), 'balances.csv');
    form.append('account_files_mapping', JSON.stringify({ 'balances.csv': account_id }));
    const up = await c.upload<UploadResponse>('/account-balance-history/upload/', form);
    const parsed = await c.query<{ parseBalanceHistory: UploadSessionData }>(PARSE_BALANCE_HISTORY_Q, { input: { sessionKey: up.session_key } });
    let session = parsed.parseBalanceHistory.uploadBalanceHistorySession;
    for (let i = 0; i < 30 && !done(session); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      session = (await c.query<UploadSessionData>(UPLOAD_SESSION_Q, { sessionKey: up.session_key })).uploadBalanceHistorySession;
    }
    if (!session || session.status.toLowerCase() !== 'completed') {
      throw new Error(`balance upload ${session?.status ?? 'unknown'}: ${session?.errorMessage ?? 'no detail'}`);
    }
    return { account_id, account: acct.displayName, ...preview, status: session.status };
  },
});
