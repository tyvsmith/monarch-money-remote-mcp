// Records every GraphQL call and answers from a scripted map keyed by operation name.
import type { MonarchClient } from '../../src/monarch/client.ts';
import { setMonarchClientForTests } from '../../src/monarch/session.ts';

export interface Call {
  op: string;
  variables: Record<string, unknown>;
}
type Scripted = unknown | ((vars: Record<string, unknown>, n: number) => unknown);

export function opName(document: string): string {
  return /\b(?:query|mutation)\s+([A-Za-z0-9_]+)/.exec(document)?.[1] ?? document.slice(0, 40);
}

export function installFakeMonarch(script: Record<string, Scripted>) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const client: MonarchClient = {
    async query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
      const op = opName(document);
      calls.push({ op, variables });
      const n = (counts.get(op) ?? 0) + 1;
      counts.set(op, n);
      if (!(op in script)) throw new Error(`fake monarch: no script for ${op}`);
      const s = script[op];
      return (typeof s === 'function' ? (s as (v: Record<string, unknown>, n: number) => unknown)(variables, n) : s) as T;
    },
    async upload<T>(): Promise<T> {
      throw new Error('fake monarch: upload not scripted');
    },
  };
  setMonarchClientForTests(client);
  return { calls, byOp: (op: string) => calls.filter((c) => c.op === op), uninstall: () => setMonarchClientForTests(null) };
}
