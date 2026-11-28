/**
 * @file The published `./server/sql` entry (package.json exports) is this barrel. Hosts import the
 * SQL identity stores from it, so its runtime surface is a public contract: exactly these
 * factories and repos, each the implementation module's own export (not a stale copy or a swap).
 */
import { expect, test } from 'vitest';
import * as entry from '../index.js';
import { SqlPrincipalPolicyRepo, SqlPrincipalRoleRepo, SqlRolePolicyRepo } from '../assignments.js';
import { createSqlMfaStore } from '../mfa.js';
import { createSqlPasskeyStore } from '../passkeys.js';
import { createSqlRecoveryCodeStore } from '../recovery-codes.js';

test('the server/sql entry exposes exactly the SQL identity stores and assignment repos', () => {
  expect(Object.keys(entry).sort()).toEqual(['SqlPrincipalPolicyRepo', 'SqlPrincipalRoleRepo', 'SqlRolePolicyRepo',
    'createSqlMfaStore', 'createSqlPasskeyStore', 'createSqlRecoveryCodeStore']);
});

test('each entry export is the implementing module\'s own binding', () => {
  expect(entry.createSqlRecoveryCodeStore).toBe(createSqlRecoveryCodeStore);
  expect(entry.createSqlPasskeyStore).toBe(createSqlPasskeyStore);
  expect(entry.createSqlMfaStore).toBe(createSqlMfaStore);
  expect(entry.SqlPrincipalPolicyRepo).toBe(SqlPrincipalPolicyRepo);
  expect(entry.SqlPrincipalRoleRepo).toBe(SqlPrincipalRoleRepo);
  expect(entry.SqlRolePolicyRepo).toBe(SqlRolePolicyRepo);
});
