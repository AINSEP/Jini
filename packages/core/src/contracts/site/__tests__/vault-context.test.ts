import assert from 'node:assert/strict';
import { test } from 'vitest';
import { VaultError } from '../../vault.js';
import { authorizeScopedVaultContext } from '../vault-context.js';

test('scoped vault authority refuses a principal or binding before storage access', async () => {
  const scope = { kind: 'api', ownerKey: 'owner' };
  const context = { ...scope, principalId: null, binding: null };
  await authorizeScopedVaultContext({ context, scope });
  for (const refused of [{ ...context, principalId: 'principal' }, { ...context, binding: 'binding' }, { ...context, kind: 'other' }, { ...context, ownerKey: 'other' }]) {
    await assert.rejects(authorizeScopedVaultContext({ context: refused, scope }), error => error instanceof VaultError && error.code === 'context');
  }
});
