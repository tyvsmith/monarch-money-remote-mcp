// Generate openapi.yaml (JSON body; the .yaml name is kept for existing GPT setups) from the tool registry.
// Custom GPT Actions allow at most 30 operations per action, so the document follows the deployment's
// write setting: reads only by default, all 41 with MONARCH_ENABLE_WRITES=1 (then split across two actions).
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { tools, writesEnabled } from '../src/tools/index.ts';

const paths: Record<string, unknown> = {};
for (const t of tools) {
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
    description: `Mirrors the official Monarch MCP tool contract. ${writesEnabled ? 'Includes write tools.' : 'Read tools only; write tools respond 404 unless the deployment sets MONARCH_ENABLE_WRITES=1.'}`,
  },
  servers: [{ url: process.env.PUBLIC_URL ?? 'https://REPLACE-WITH-CLOUD-RUN-URL' }],
  components: { securitySchemes: { ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
  security: [{ ApiKeyAuth: [] }],
  paths,
};
await writeFile('openapi.yaml', JSON.stringify(doc, null, 2) + '\n');
console.log(`wrote openapi.yaml with ${tools.length} operations (${writesEnabled ? 'reads + writes' : 'reads only'})`);
