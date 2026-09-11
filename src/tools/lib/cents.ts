import { ToolInputError } from '../registry.ts';

export const toCents = (n: number) => Math.round(n * 100);

/** Monarch rejects splits that are not whole cents or do not sum to the parent. */
export function assertWholeCents(amounts: number[], total: number): void {
  for (const a of amounts) {
    if (Math.abs(a * 100 - Math.round(a * 100)) > 1e-6) throw new ToolInputError(`split amounts must be whole cents (got ${a})`);
  }
  const sum = amounts.reduce((s, a) => s + toCents(a), 0);
  if (sum !== toCents(total)) {
    throw new ToolInputError(`split amounts must sum to the transaction amount (${total}); got ${sum / 100}`);
  }
}
