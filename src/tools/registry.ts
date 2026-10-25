// One table drives everything: MCP registration, REST routes, and OpenAPI are
// derived from ToolDef entries, so a tool is declared exactly once.
import { z } from 'zod';

export class ToolInputError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  input: S;
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>;
  /** Skip the official `intent` arguments (only ReportIssue omits them upstream). */
  noIntent?: boolean;
}

/** The official connector's task categories. Every data tool takes `intent`. */
export const INTENTS = [
  'budgeting',
  'spending_analysis',
  'cash_flow_planning',
  'savings_goals',
  'debt_management',
  'investment_tracking',
  'net_worth_tracking',
  'bills_and_subscriptions',
  'tax_preparation',
  'organizing_finances',
  'financial_planning',
  'other',
] as const;

/**
 * Official tools require `intent` and forward it to the data institutions. This
 * service accepts the same arguments so prompts written for the official
 * connector validate, but it does not forward them anywhere.
 */
export const intentInput = {
  intent: z
    .enum(INTENTS)
    .nullable()
    .optional()
    .describe("The general financial task this call supports. Pick the closest category; use 'other' only when none fit. Optional here; accepted for parity with the official connector and not shared with anyone."),
  intent_description: z
    .string()
    .max(60)
    .nullable()
    .optional()
    .describe("Only when intent is 'other': a generic 2-5 word label for the task category, e.g. 'retirement planning'. Name the task, never the reason behind it."),
};

export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S & typeof intentInput> {
  if (def.noIntent) return def as ToolDef<S & typeof intentInput>;
  return { ...def, input: { ...intentInput, ...def.input } } as unknown as ToolDef<S & typeof intentInput>;
}

export interface ToolFailure {
  error: string;
  code: string | null;
  status: number;
}

/** Validate, run, and normalize errors once for every transport (MCP, REST). */
export async function invokeTool(def: ToolDef, rawArgs: unknown): Promise<{ ok: true; data: unknown } | { ok: false; failure: ToolFailure }> {
  const parsed = z.object(def.input).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return { ok: false, failure: { error: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '), code: 'INVALID_INPUT', status: 400 } };
  }
  try {
    return { ok: true, data: await def.handler(parsed.data as never) };
  } catch (err) {
    const e = err as Error & { statusCode?: number; code?: string; name?: string };
    let status = typeof e.statusCode === 'number' ? e.statusCode : 500;
    // Upstream auth/throttle failures must not read as this service's own auth: surface them as gateway errors.
    if (e.name === 'MonarchError' && [401, 403, 429].includes(status)) status = 503;
    if (status >= 500) console.error(`[tool ${def.name}]`, err);
    return { ok: false, failure: { error: e.message ?? String(err), code: e.code ?? null, status } };
  }
}

/** Official tools pass structured filters as JSON strings. Parse and validate here. */
export function jsonArg<T>(raw: string | null | undefined, schema: z.ZodType<T>, name: string): T {
  const text = (raw ?? '').trim();
  let value: unknown = {};
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      throw new ToolInputError(`${name} must be a JSON string`);
    }
  }
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new ToolInputError(
      `${name}: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`,
    );
  }
  return r.data;
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD');
export const nullableList = z.array(z.string()).nullable().optional();
export const optStr = z.string().nullable().optional();
export const optBool = z.boolean().nullable().optional();
export const optNum = z.number().nullable().optional();

/** Official dry_run flag; `preview` names the fields the preview returns. */
export const dryRun = (preview: string) =>
  z
    .boolean()
    .optional()
    .default(false)
    .describe(
      `if true, returns a preview (${preview}) without writing. Call once with dry_run=true to show the user what will change, then call again with dry_run=false to commit.`,
    );

/** Monarch's BusinessEntitySetInput, or undefined when nothing is requested. */
export function businessEntitySet(ids: string[] | null | undefined, includeUnassigned: boolean | null | undefined) {
  if (!ids?.length && !includeUnassigned) return undefined;
  return { businessEntityIds: ids ?? [], includeUnassigned: includeUnassigned ?? false };
}
