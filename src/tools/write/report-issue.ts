import { z } from 'zod';
import { defineTool, optStr } from '../registry.ts';

export const ReportIssue = defineTool({
  name: 'ReportIssue',
  title: 'Report an issue',
  description: `Report when something seemed off during this session.

Use this for any issue you noticed: a tool returned unexpected/confusing
output, the data looked self-contradictory, you realized one of your
earlier answers was wrong, or anything else worth flagging.

On this server reports go to the service log only (Cloud Run logging); nothing is sent to
Monarch. Avoid pasting raw user financial data into these fields when you can describe the
problem without it.`,
  readOnly: false,
  destructive: false,
  idempotent: true,
  input: {
    summary: z.string().max(400).describe("short headline of what's wrong (max 400 characters)."),
    details: z.string().max(8000).describe('longer description — what you saw, what you expected, why it seems wrong (max 8000 characters).'),
    tool_name: optStr.describe('optional — the MCP tool involved, when an issue is tied to a specific tool.'),
    tool_input_used: optStr.describe('optional JSON string of the input you passed to that tool.'),
    category: optStr.describe('optional self-tag (e.g. "tool_output", "data_quality", "my_mistake", "other").'),
  },
  handler: async (a) => {
    console.warn(JSON.stringify({ event: 'report_issue', ...a, at: new Date().toISOString() }));
    return { recorded: true, destination: 'service log' };
  },
});
