// The official tools take display names ("Cash", "Brokerage (Taxable)");
// Monarch's filters take internal names ("depository", "brokerage_taxable").
import type { AccountTypeInfo } from '../../monarch/ops/accounts.ts';

export function resolveAccountTypeNames(wanted: string[], types: AccountTypeInfo[]): string[] {
  const w = new Set(wanted.map((s) => s.toLowerCase()));
  return types.filter((t) => w.has(t.display.toLowerCase()) || w.has(t.name.toLowerCase())).map((t) => t.name);
}

export function resolveAccountSubtypeNames(wanted: string[], types: AccountTypeInfo[]): string[] {
  const w = new Set(wanted.map((s) => s.toLowerCase()));
  const out: string[] = [];
  for (const t of types) {
    for (const s of t.possibleSubtypes) {
      if (w.has(s.display.toLowerCase()) || w.has(s.name.toLowerCase())) out.push(s.name);
    }
  }
  return out;
}
