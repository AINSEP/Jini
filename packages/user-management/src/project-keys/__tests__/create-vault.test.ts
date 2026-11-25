import { expect, it, vi } from 'vitest';
import type { VaultPutRecord, VaultRepoPort } from '@jini-ai/core/contracts/vault';
import { projectKeyCreateVault } from '../create-vault.js';

it('replacement checks the grant inside the owner transaction', async () => {
  let inside = false;
  const owner: VaultRepoPort = { find: vi.fn(), list: vi.fn(), put: vi.fn(), patchMeta: vi.fn(), delete: vi.fn() };
  const view: VaultRepoPort = { ...owner, find: vi.fn(async () => { expect(inside).toBe(true); return null; }) };
  const record: VaultPutRecord = { workspaceId: 'project', id: 'key', kind: 'custom', ownerKey: 'owner', principalId: null,
    binding: null, provider: null, label: 'key', revision: 1, sealed: null, last4: null, tokenLength: null,
    meta: {}, createdAt: '', updatedAt: '' };
  const port = projectKeyCreateVault({ owner, view, conflictError: () => new Error('conflict'), replacementRefusedMessage: 'refused' }, {
    allowReplacement: true, transaction: async ({ run }) => { inside = true; try { return await run(); } finally { inside = false; } },
  });
  await expect(port.put({ record, expectedRevision: 1 })).rejects.toThrow('refused');
  expect(view.find).toHaveBeenCalledWith(record);
  expect(owner.put).not.toHaveBeenCalled();
});
