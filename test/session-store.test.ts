import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedSession } from '../src/session-store.ts';

test('legacy bare token gets the fallback device uuid', () => {
  assert.deepEqual(parseSavedSession('abc\n', 'dev'), { token: 'abc', deviceUuid: 'dev' });
});
test('json session round-trips', () => {
  assert.deepEqual(parseSavedSession('{"token":"t","deviceUuid":"d"}', 'x'), { token: 't', deviceUuid: 'd' });
});
test('json without a token is null', () => {
  assert.equal(parseSavedSession('{"deviceUuid":"d"}', 'x'), null);
});
test('empty is null', () => {
  assert.equal(parseSavedSession('  ', 'd'), null);
});
