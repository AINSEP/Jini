import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AuthorizeFn } from '@jini-ai/core/contracts/events';
import { createSurfaceForms } from '../forms.js';

function setup(options: { principalId?: string; workspaceId?: string; allowed?: boolean; authorizeError?: Error } = {}) {
  const authorizations: Parameters<AuthorizeFn>[0][] = [];
  const reads: { workspaceId: string }[] = [];
  const port = createSurfaceForms({
    siteWorkspaceId: 'ws-1', workspaceId: options.workspaceId ?? 'ws-1',
    ...(options.principalId === undefined ? {} : { principalId: options.principalId }),
    authorize: async (input) => {
      authorizations.push(input);
      if (options.authorizeError) throw options.authorizeError;
      return { allowed: options.allowed ?? true, reason: 'test' };
    },
    forms: { list: async (input) => {
      reads.push(input);
      return [{ workspaceId: 'ws-1', slug: 'contact', name: 'Contact us', fields: ['private'], id: 'row-1' }];
    } },
  });
  return { port, authorizations, reads };
}

test('lists only slug/title after the forms permission check, scoped to this workspace', async () => {
  const { port, authorizations, reads } = setup({ principalId: 'owner' });
  assert.deepEqual(await port.list({}), [{ slug: 'contact', title: 'Contact us' }]);
  assert.deepEqual(authorizations, [{ principalId: 'owner', workspaceId: 'ws-1', permission: 'admin.forms.manage', entityType: 'form_definition' }]);
  assert.deepEqual(reads, [{ workspaceId: 'ws-1' }]);
});

test('missing principal and another workspace are refused before authorization or repository access', async () => {
  for (const options of [{}, { principalId: 'owner', workspaceId: 'ws-other' }]) {
    const { port, authorizations, reads } = setup(options);
    await assert.rejects(port.list({}), /signed-in admin|workspace/);
    assert.deepEqual({ authorizations, reads }, { authorizations: [], reads: [] });
  }
});

test('a denied forms permission and an authorization failure never read forms', async () => {
  for (const options of [{ allowed: false }, { authorizeError: new Error('authorization unavailable') }]) {
    const { port, reads } = setup({ principalId: 'owner', ...options });
    await assert.rejects(port.list({}));
    assert.deepEqual(reads, []);
  }
});
