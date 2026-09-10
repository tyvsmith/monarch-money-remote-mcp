// REST surface for Custom GPT Actions: one POST per tool, body = tool args.
// openapi.yaml is generated from the same registry (npm run gen-openapi).
import { Router } from 'express';
import { z } from 'zod';
import { findTool, tools } from '../tools/index.ts';

export const restRouter = Router();

restRouter.get('/tools', (_req, res) => {
  res.json({ tools: tools.map((t) => ({ name: t.name, title: t.title, read_only: t.readOnly })) });
});

restRouter.post('/tools/:name', async (req, res, next) => {
  const t = findTool(req.params.name);
  if (!t) {
    res.status(404).json({ error: `unknown tool ${req.params.name}` });
    return;
  }
  const parsed = z.object(t.input).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return;
  }
  try {
    res.json(await t.handler(parsed.data as never));
  } catch (err) {
    next(err);
  }
});
