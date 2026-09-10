import type { RequestHandler } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { tools, writesEnabled } from '../tools/index.ts';
import { invokeTool } from '../tools/registry.ts';

const SERVER_INSTRUCTIONS = `Monarch Money MCP (third-party stand-in for the official Monarch connector while it is paused).

Access to the household's Monarch Money data. Read tools return stable IDs for
the entities they list (categories, tags, merchants, businesses, rules,
household members, transactions); write tools take those IDs. Look an entity
up with a read tool first (GetMerchants(search=...), GetCategories,
GetHouseholdMembers), then pass its id to the write tool.

Merchants: Monarch creates merchants by name. CreateMerchant returns an
existing merchant's id when the name matches; otherwise pass merchant_name to
the write tool and Monarch creates it on first use.

Dates are ISO YYYY-MM-DD. Amounts are signed: outflows negative, inflows positive.
${writesEnabled ? '' : '\nThis deployment exposes read tools only.'}`;

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'monarch-money-remote-mcp', version: '0.2.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );
  for (const t of tools) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.input,
        annotations: {
          readOnlyHint: t.readOnly,
          destructiveHint: t.destructive ?? !t.readOnly,
          idempotentHint: t.idempotent ?? t.readOnly,
          openWorldHint: false,
        },
      },
      async (args) => {
        const r = await invokeTool(t, args);
        if (r.ok) return { content: [{ type: 'text' as const, text: JSON.stringify(r.data, null, 1) }] };
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(r.failure) }] };
      },
    );
  }
  return server;
}

export const mcpHandler: RequestHandler = async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal server error' }, id: null });
    }
  }
};
