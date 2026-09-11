import { ToolInputError } from '../registry.ts';

export interface PayloadError {
  message?: string | null;
  code?: string | null;
  fieldErrors?: Array<{ field: string; messages: string[] }> | null;
}

/** Monarch mutations report validation problems in a payload-level errors list rather than as GraphQL errors. */
export function assertNoPayloadErrors(payload: { errors?: PayloadError[] | null } | null | undefined, what: string): void {
  const errs = payload?.errors ?? [];
  if (!errs.length) return;
  const parts: string[] = [];
  for (const e of errs) {
    if (e.message) parts.push(e.message);
    for (const f of e.fieldErrors ?? []) parts.push(`${f.field}: ${f.messages.join(', ')}`);
  }
  throw new ToolInputError(`${what}: ${parts.join('; ') || 'Monarch rejected the request'}`);
}
