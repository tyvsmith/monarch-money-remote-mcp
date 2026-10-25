export type Interval = 'day' | 'week' | 'month';

/** Official default: daily up to 31 days, weekly up to 92 days, monthly beyond. */
export function defaultInterval(startDate: string, endDate: string): Interval {
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
  if (days <= 31) return 'day';
  if (days <= 92) return 'week';
  return 'month';
}

/** Thin daily snapshots to the requested interval, always keeping the first and last reading. */
export function thinReadings<T extends { date: string }>(rows: T[], interval: Interval): T[] {
  if (rows.length === 0 || interval === 'day') return rows;
  const out =
    interval === 'week'
      ? rows.filter((_, i) => i % 7 === 0)
      : rows.filter((r, i) => i === 0 || r.date.slice(0, 7) !== rows[i - 1]!.date.slice(0, 7));
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
