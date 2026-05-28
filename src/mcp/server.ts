import type { RequestHandler } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools.ts';

const SERVER_INSTRUCTIONS = `Read-only access to the user's Monarch Money account. Tools cover accounts, balances, transactions, budgets, cashflow, recurring bills, savings goals, merchants, categories, tags, institutions, net worth, and Monarch's dashboard insights.

Guidance:
- Prefer compact responses. On accounts_getAll always pass verbosity="ultra-light" unless the user explicitly needs balance history, account type detail, or institution metadata — full payload can exceed 30KB while ultra-light is a few hundred bytes.
- For "how much did I spend on X" use transactions_getTransactions with --search and sum client-side. Bump limit (max 500) and use offset for older pages. **Always pass verbosity="ultra-light" or "light"** unless the user explicitly needs full transaction detail — the response is post-formatted into a compact text view that cuts tokens 70–95%.
- For period-aggregated questions ("what did I spend in 2024", "category breakdown for Q3", "how am I doing this month") prefer cashflow_get or cashflow_getSummary — orders of magnitude smaller payload than scanning transactions.
- Dates are ISO YYYY-MM-DD. Endpoints that take a date range default to the current month when both are omitted.
- absAmountRange is [min, max] with either bound optional: [50] = ≥$50, [,100] = ≤$100, [50,200] = $50–$200.
- isCredit on transactions: true = inflows only, false = outflows only.
- All tools are read-only. There are no write/create/update/delete operations.`;

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'monarch-money-remote-mcp', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server);
  return server;
}

export const mcpHandler: RequestHandler = async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'internal server error' },
        id: null,
      });
    }
  }
};
