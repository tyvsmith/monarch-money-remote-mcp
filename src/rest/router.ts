// REST surface for Custom GPT Actions: one POST per tool, body = tool args.
// openapi.yaml is generated from the same registry (npm run gen-openapi).
import { Router } from 'express';
import { findTool, tools } from '../tools/index.ts';
import { invokeTool } from '../tools/registry.ts';

export const restRouter = Router();

restRouter.get('/tools', (_req, res) => {
  res.json({ tools: tools.map((t) => ({ name: t.name, title: t.title, read_only: t.readOnly })) });
});

restRouter.post('/tools/:name', async (req, res) => {
  const t = findTool(req.params.name);
  if (!t) {
    res.status(404).json({ error: `unknown tool ${req.params.name}`, code: 'UNKNOWN_TOOL' });
    return;
  }
  const r = await invokeTool(t, req.body);
  if (r.ok) res.json(r.data);
  else res.status(r.failure.status).json({ error: r.failure.error, code: r.failure.code });
});
