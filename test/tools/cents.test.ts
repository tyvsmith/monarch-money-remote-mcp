import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertWholeCents, toCents } from '../../src/tools/lib/cents.ts';

test('rejects fractional cents and mismatched sums', () => {
  assert.equal(toCents(-0.1 + -0.2), -30);
  assert.throws(() => assertWholeCents([-0.005, -0.005], -0.01), /whole cents/);
  assert.throws(() => assertWholeCents([-0.01, -0.02], -0.02), /sum/);
  assertWholeCents([-0.01, -0.01], -0.02);
});
