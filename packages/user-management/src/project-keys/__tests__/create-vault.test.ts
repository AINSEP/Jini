import { expect, it, vi } from 'vitest';
import { VaultError, type VaultPutRecord, type VaultRepoPort } from '@jini-ai/core/contracts/vault';
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

const ports = () => {
  const owner: VaultRepoPort = { find: vi.fn(), list: vi.fn(), put: vi.fn(), patchMeta: vi.fn(), delete: vi.fn() };
  const view: VaultRepoPort = { find: vi.fn(), list: vi.fn().mockResolvedValue(['viewed']), put: vi.fn(), patchMeta: vi.fn(), delete: vi.fn() };
  return { owner, view };
};
const record: VaultPutRecord = { workspaceId: 'project', id: 'key', kind: 'custom', ownerKey: 'owner', principalId: null,
  binding: null, provider: null, label: 'key', revision: 1, sealed: null, last4: null, tokenLength: null, meta: {}, createdAt: '', updatedAt: '' };

it('a new secret is created in the owner vault while reads stay on the granted view', async () => {
  const { owner, view } = ports();
  const saved = { ...record, isDefault: true };
  vi.mocked(owner.put).mockResolvedValue(saved);
  const port = projectKeyCreateVault({ owner, view, conflictError: () => new Error('conflict'), replacementRefusedMessage: 'refused' });
  expect(await port.put({ record, expectedRevision: null }, {})).toBe(saved);
  expect(owner.put).toHaveBeenCalledWith({ record, expectedRevision: null }, {});
  expect(await port.list({ workspaceId: 'project', kind: 'custom', ownerKey: 'owner', principalId: null })).toEqual(['viewed']);
  expect(owner.list).not.toHaveBeenCalled();
});

it('a vault conflict on create becomes the caller-provided conflict error; other failures pass through', async () => {
  const { owner, view } = ports();
  const conflictError = vi.fn(() => new Error('name taken'));
  const port = projectKeyCreateVault({ owner, view, conflictError, replacementRefusedMessage: 'refused' });
  vi.mocked(owner.put).mockRejectedValueOnce(new VaultError({ code: 'conflict' }));
  await expect(port.put({ record, expectedRevision: null })).rejects.toThrow('name taken');
  expect(conflictError).toHaveBeenCalledWith({});
  const other = new VaultError({ code: 'invalid-record' });
  vi.mocked(owner.put).mockRejectedValueOnce(other);
  await expect(port.put({ record, expectedRevision: null })).rejects.toBe(other);
  const plain = new Error('disk full');
  vi.mocked(owner.put).mockRejectedValueOnce(plain);
  await expect(port.put({ record, expectedRevision: null })).rejects.toBe(plain);
  expect(conflictError).toHaveBeenCalledTimes(1);
});

it('replacement is refused without consulting the grant unless explicitly allowed', async () => {
  const { owner, view } = ports();
  const port = projectKeyCreateVault({ owner, view, conflictError: () => new Error('conflict'), replacementRefusedMessage: 'refused' });
  await expect(port.put({ record, expectedRevision: 1 })).rejects.toThrow('refused');
  expect(view.find).not.toHaveBeenCalled();
  expect(owner.put).not.toHaveBeenCalled();
});

it('an allowed replacement of a granted entry writes through the default transaction', async () => {
  const { owner, view } = ports();
  vi.mocked(view.find).mockResolvedValue({ ...record, isDefault: false });
  vi.mocked(owner.put).mockResolvedValue({ ...record, isDefault: false, revision: 2 });
  const port = projectKeyCreateVault({ owner, view, conflictError: () => new Error('conflict'), replacementRefusedMessage: 'refused' }, { allowReplacement: true });
  expect((await port.put({ record, expectedRevision: 1 }, {})).revision).toBe(2);
  expect(owner.put).toHaveBeenCalledWith({ record, expectedRevision: 1 }, {});
});
