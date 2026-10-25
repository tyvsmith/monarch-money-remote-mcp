import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { defineTool, invokeTool, jsonArg, ToolInputError } from '../../src/tools/registry.ts';

test('jsonArg parses and validates, treats empty as {}', () => {
  const s = z.object({ a: z.number().optional() });
  assert.deepEqual(jsonArg('{"a":1}', s, 'filters'), { a: 1 });
  assert.deepEqual(jsonArg('', s, 'filters'), {});
  assert.deepEqual(jsonArg(undefined, s, 'filters'), {});
  assert.throws(() => jsonArg('{"a":"x"}', s, 'filters'), ToolInputError);
  assert.throws(() => jsonArg('not json', s, 'filters'), /filters/);
});

test('jsonArg accepts arrays when the schema is an array', () => {
  assert.deepEqual(jsonArg('[{"amount":1}]', z.array(z.object({ amount: z.number() })), 'splits'), [{ amount: 1 }]);
});

test('defineTool adds the optional intent arguments and invokeTool validates them', async () => {
  const t = defineTool({ name: 'X', title: 'x', description: 'd', readOnly: true, input: { q: z.string() }, handler: async ({ q }) => q });
  assert.equal(t.name, 'X');
  assert.ok('intent' in t.input && 'intent_description' in t.input);
  assert.deepEqual(await invokeTool(t, { q: 'a' }), { ok: true, data: 'a' });
  assert.deepEqual(await invokeTool(t, { q: 'a', intent: 'budgeting' }), { ok: true, data: 'a' });
  assert.deepEqual(await invokeTool(t, { q: 'a', intent: 'other', intent_description: 'rent affordability' }), { ok: true, data: 'a' });
  const bad = await invokeTool(t, { q: 'a', intent: 'nope' });
  assert.equal(bad.ok, false);
});

test('defineTool skips intent for noIntent tools', () => {
  const t = defineTool({ name: 'Y', title: 'y', description: 'd', readOnly: false, noIntent: true, input: { q: z.string() }, handler: async ({ q }) => q });
  assert.deepEqual(Object.keys(t.input), ['q']);
});
