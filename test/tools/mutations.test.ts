import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoPayloadErrors } from '../../src/tools/lib/mutations.ts';
import { ToolInputError } from '../../src/tools/registry.ts';

test('passes on null/empty errors', () => {
  assertNoPayloadErrors({ errors: null }, 'x');
  assertNoPayloadErrors({ errors: [] }, 'x');
  assertNoPayloadErrors(null, 'x');
});

test('joins message and field errors', () => {
  assert.throws(
    () => assertNoPayloadErrors({ errors: [{ message: 'bad', fieldErrors: [{ field: 'name', messages: ['taken'] }] }] }, 'CreateTag'),
    (e: unknown) => e instanceof ToolInputError && /CreateTag: bad; name: taken/.test((e as Error).message),
  );
});
