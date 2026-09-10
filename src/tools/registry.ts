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
}

export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
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
