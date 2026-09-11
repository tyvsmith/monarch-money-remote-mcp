export const CREDIT_SCORES_Q = /* GraphQL */ `
  query CreditScores($startDate: Date, $endDate: Date) {
    creditScoreSnapshots(startDate: $startDate, endDate: $endDate) {
      id reportedDate score user { id displayName }
    }
  }`;
export interface CreditScoresData {
  creditScoreSnapshots: Array<{ id: string; reportedDate: string; score: number; user: { id: string; displayName: string } }> | null;
}

export const NET_WORTH_Q = /* GraphQL */ `
  query NetWorth($filters: AggregateSnapshotFilters) {
    aggregateSnapshots(filters: $filters) { date balance assetsBalance liabilitiesBalance }
  }`;
export interface NetWorthData {
  aggregateSnapshots: Array<{ date: string; balance: number; assetsBalance: number | null; liabilitiesBalance: number | null }>;
}

// Returns the account's full daily history; callers filter by date.
export const ACCOUNT_SNAPSHOTS_Q = /* GraphQL */ `
  query AccountSnapshots($accountId: UUID) {
    snapshotsForAccount(accountId: $accountId) { date signedBalance }
  }`;
export interface AccountSnapshotsData {
  snapshotsForAccount: Array<{ date: string; signedBalance: number }>;
}
