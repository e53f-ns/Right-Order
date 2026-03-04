import test from 'node:test';
import assert from 'node:assert/strict';
import { clampInt, clampFloat, requireWhitelistedField, isValidTxHashFormat } from '../../src/security/validators.js';

test('clampInt clamps and defaults safely', () => {
  assert.equal(clampInt('10', 1, 1, 100), 10);
  assert.equal(clampInt('-5', 1, 1, 100), 1);
  assert.equal(clampInt('5000', 1, 1, 100), 100);
  assert.equal(clampInt('not-a-number', 7, 1, 100), 7);
  assert.equal(clampInt('10; DROP TABLE users;', 7, 1, 100), 7);
});

test('clampFloat clamps and defaults safely', () => {
  assert.equal(clampFloat('3.14', 0, 0, 10), 3.14);
  assert.equal(clampFloat('-99', 0, 0, 10), 0);
  assert.equal(clampFloat('999', 0, 0, 10), 10);
  assert.equal(clampFloat('NaN', 5, 0, 10), 5);
  assert.equal(clampFloat('1.5 union select * from users', 5, 0, 10), 5);
});

test('requireWhitelistedField rejects forbidden sort/filter fields', () => {
  const allowed = ['createdAt', 'email', 'status'] as const;
  assert.equal(requireWhitelistedField('createdAt', allowed), 'createdAt');
  assert.equal(requireWhitelistedField('drop table users', allowed), null);
  assert.equal(requireWhitelistedField('__proto__', allowed), null);
});

test('isValidTxHashFormat validates tx hashes strictly', () => {
  const validNoPrefix = 'a'.repeat(64);
  const validWithPrefix = `0x${'b'.repeat(64)}`;
  assert.equal(isValidTxHashFormat(validNoPrefix), true);
  assert.equal(isValidTxHashFormat(validWithPrefix), true);
  assert.equal(isValidTxHashFormat('0x1234'), false);
  assert.equal(isValidTxHashFormat('"; DROP TABLE Payment; --'), false);
});
