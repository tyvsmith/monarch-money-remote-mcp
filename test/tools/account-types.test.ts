import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccountTypeNames, resolveAccountSubtypeNames } from '../../src/tools/lib/account-types.ts';
import { parseOwnership, ownershipToSet } from '../../src/tools/lib/ownership.ts';

const types = [
  { name: 'depository', display: 'Cash', group: 'asset', possibleSubtypes: [{ name: 'checking', display: 'Checking' }] },
  { name: 'brokerage', display: 'Investments', group: 'asset', possibleSubtypes: [{ name: 'brokerage_taxable', display: 'Brokerage (Taxable)' }] },
];

test('display names and raw names both resolve', () => {
  assert.deepEqual(resolveAccountTypeNames(['Cash', 'brokerage', 'Nope'], types), ['depository', 'brokerage']);
  assert.deepEqual(resolveAccountSubtypeNames(['Checking', 'Brokerage (Taxable)'], types), ['checking', 'brokerage_taxable']);
});

test('ownership maps official shape to OwnershipSetInput', () => {
  const members = [{ id: 'u1', name: 'Ty Smith', displayName: 'Ty' }, { id: 'u2', name: 'Sam Doe', displayName: 'Sam' }];
  assert.equal(ownershipToSet(parseOwnership('{}'), members, 'u1'), undefined);
  assert.deepEqual(ownershipToSet(parseOwnership('{"scope":"user","user":"self"}'), members, 'u1'), { userIds: ['u1'], includeJointlyOwned: true });
  assert.deepEqual(ownershipToSet(parseOwnership('{"scope":"user","user":"Sam","jointly_owned_setting":false}'), members, 'u1'), { userIds: ['u2'], includeJointlyOwned: false });
  assert.throws(() => ownershipToSet(parseOwnership('{"scope":"user","user":"Nobody"}'), members, 'u1'), /not a household member/);
});
