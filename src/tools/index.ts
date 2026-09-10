// Every tool, in the official server's order. Write tools are exposed only
// when MONARCH_ENABLE_WRITES=1 so a deploy defaults to read-only.
import type { ToolDef } from './registry.ts';
import { GetTags } from './read/tags.ts';

const readTools: ToolDef[] = [GetTags as ToolDef];
const writeTools: ToolDef[] = [];

export const writesEnabled = process.env.MONARCH_ENABLE_WRITES === '1';
export const allTools: ToolDef[] = [...readTools, ...writeTools];
export const tools: ToolDef[] = writesEnabled ? allTools : readTools;

export function findTool(name: string): ToolDef | undefined {
  return tools.find((t) => t.name === name);
}
