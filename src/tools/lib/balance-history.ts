export interface BalanceEntry {
  date: string;
  balance: number;
}

export function balancesToCsv(entries: BalanceEntry[]): string {
  const rows = [...entries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => `${e.date},${e.balance}`);
  return ['Date,Balance', ...rows].join('\n') + '\n';
}

export function previewBalanceUpload(existing: BalanceEntry[], entries: BalanceEntry[], currentBalance: number, today: string) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const start_date = sorted[0]!.date;
  const end_date = sorted.at(-1)!.date;
  const replaced = existing.filter((e) => e.date >= start_date && e.date <= end_date).length;
  const latestExisting = existing.map((e) => e.date).sort().at(-1) ?? '';
  const reachesLatest = end_date >= latestExisting || end_date >= today;
  return {
    start_date,
    end_date,
    snapshots_to_write: sorted.length,
    existing_snapshots_replaced: replaced,
    current_balance_changes: reachesLatest && sorted.at(-1)!.balance !== currentBalance,
  };
}
