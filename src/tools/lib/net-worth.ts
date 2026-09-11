/** Official behavior: weekly readings for ranges over 60 days, daily otherwise. */
export function thinToWeekly<T extends { date: string }>(rows: T[]): T[] {
  if (rows.length === 0) return rows;
  const days = (Date.parse(rows.at(-1)!.date) - Date.parse(rows[0]!.date)) / 86_400_000;
  if (days <= 60) return rows;
  const out = rows.filter((_, i) => i % 7 === 0);
  if (out.at(-1) !== rows.at(-1)) out.push(rows.at(-1)!);
  return out;
}

export function budgetStatus(planned: number | null, actual: number | null, type: string): 'over' | 'under' | 'on' | 'unbudgeted' {
  const p = planned ?? 0;
  const a = Math.abs(actual ?? 0);
  if (!p) return a ? 'unbudgeted' : 'on';
  if (type === 'income') return a < p ? 'under' : a > p ? 'over' : 'on';
  const r = a / p;
  return r > 1 ? 'over' : r < 0.9 ? 'under' : 'on';
}
