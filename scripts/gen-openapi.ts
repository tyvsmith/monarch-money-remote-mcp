// Generate openapi.yaml (JSON body; the .yaml name is kept for existing GPT setups) from the tool registry.
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { allTools } from '../src/tools/index.ts';

const paths: Record<string, unknown> = {};
for (const t of allTools) {
  paths[`/tools/${t.name}`] = {
    post: {
      operationId: t.name,
      summary: t.title,
      description: t.description,
      requestBody: {
        required: true,
        content: { 'application/json': { schema: z.toJSONSchema(z.object(t.input), { target: 'openapi-3.0' }) } },
      },
      responses: { '200': { description: 'Tool result', content: { 'application/json': { schema: { type: 'object' } } } } },
    },
  };
}
const doc = {
  openapi: '3.1.0',
  info: {
    title: 'Monarch Money (unofficial MCP parity)',
    version: '0.2.0',
    description: 'Mirrors the official Monarch MCP tool contract. Write tools respond 404 unless the deployment sets MONARCH_ENABLE_WRITES=1.',
  },
  servers: [{ url: process.env.PUBLIC_URL ?? 'https://REPLACE-WITH-CLOUD-RUN-URL' }],
  components: { securitySchemes: { ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
  security: [{ ApiKeyAuth: [] }],
  paths,
};
await writeFile('openapi.yaml', JSON.stringify(doc, null, 2) + '\n');
console.log(`wrote openapi.yaml with ${allTools.length} operations`);
