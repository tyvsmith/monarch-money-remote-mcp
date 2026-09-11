import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { balancesToCsv, previewBalanceUpload } from '../../src/tools/lib/balance-history.ts';
import { UpdateAccountBalanceHistory } from '../../src/tools/write/balance-history.ts';
import { installFakeMonarch } from '../helpers/fake-monarch.ts';
import { setMonarchClientForTests } from '../../src/monarch/session.ts';

afterEach(() => setMonarchClientForTests(null));

test('csv has Date,Balance header and sorted rows', () => {
  assert.equal(balancesToCsv([{ date: '2026-02-01', balance: 5 }, { date: '2026-01-01', balance: -3.5 }]), 'Date,Balance\n2026-01-01,-3.5\n2026-02-01,5\n');
});

test('preview reports range, replaced snapshots, and current-balance change', () => {
  const p = previewBalanceUpload([{ date: '2026-01-01', balance: 1 }, { date: '2026-03-01', balance: 3 }], [{ date: '2026-01-01', balance: 2 }, { date: '2026-01-02', balance: 2 }], 3, '2026-03-01');
  assert.deepEqual(p, { start_date: '2026-01-01', end_date: '2026-01-02', snapshots_to_write: 2, existing_snapshots_replaced: 1, current_balance_changes: false });
});

test('tool refuses synced accounts and previews without uploading', async () => {
  const acct = (isManual: boolean) => ({ accounts: [{ id: 'a', displayName: 'Car', isManual, currentBalance: 10, deactivatedAt: null }] });
  installFakeMonarch({ GetAccounts: acct(false) });
  await assert.rejects(UpdateAccountBalanceHistory.handler({ account_id: 'a', balances: '[{"date":"2026-01-01","balance":1}]', dry_run: true } as never), /only manual accounts/);
  const f = installFakeMonarch({ GetAccounts: acct(true), AccountSnapshots: { snapshotsForAccount: [{ date: '2026-01-01', signedBalance: 9 }] } });
  const out = (await UpdateAccountBalanceHistory.handler({ account_id: 'a', balances: '[{"date":"2026-01-01","balance":1}]', dry_run: true } as never)) as Record<string, unknown>;
  assert.equal(out.dry_run, true);
  assert.equal(out.existing_snapshots_replaced, 1);
  assert.equal(f.byOp('ParseBalanceHistory').length, 0);
});
