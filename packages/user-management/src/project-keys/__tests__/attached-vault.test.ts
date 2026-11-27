import { expect, it, vi } from 'vitest';
import type { KeyAttachments } from '@jini-ai/core/contracts/site/project-key-attachments';
import type { VaultRecord, VaultRepoPort } from '@jini-ai/core/contracts/vault';
import { attachedOnlyVault } from '../attached-vault.js';

it('ungranted label never reads the owner vault', async () => {
  const vault: VaultRepoPort = { find: vi.fn(), list: vi.fn(), put: vi.fn(), patchMeta: vi.fn(), delete: vi.fn() };
  const attachments: KeyAttachments = {
    keyForLabel: vi.fn().mockResolvedValue('ungranted'), isAttached: vi.fn().mockResolvedValue(false),
    keysFor: vi.fn(), attach: vi.fn(), detach: vi.fn(), usersOf: vi.fn(), removeKey: vi.fn(), renameSite: vi.fn(),
  };
  const view = attachedOnlyVault({ vault, siteId: 'site', attachments, policy: { readonlyMessage: 'read only', report: vi.fn() } });
  expect(await view.findByLabel?.({ workspaceId: 'project', label: 'label' })).toBeNull();
  expect(attachments.isAttached).toHaveBeenCalledWith({ siteId: 'site', keyId: 'ungranted' });
  expect(vault.find).not.toHaveBeenCalled();
});

const row = (id: string, extra: Partial<VaultRecord> = {}): VaultRecord => ({
  workspaceId: 'project', kind: 'custom', ownerKey: 'owner', principalId: null, binding: null, id,
  provider: null, label: id, isDefault: false, revision: 1, sealed: null, last4: null, tokenLength: null,
  meta: {}, createdAt: '', updatedAt: '', ...extra,
});

function grantedView({ rows, granted, report = vi.fn(), withLabel = true }: { rows: VaultRecord[]; granted: string[]; report?: ReturnType<typeof vi.fn>; withLabel?: boolean }) {
  const vault: VaultRepoPort = {
    find: vi.fn(async ({ id }: { id: string }) => rows.find(r => r.id === id) ?? null),
    list: vi.fn(), put: vi.fn(), patchMeta: vi.fn(), delete: vi.fn(),
  };
  const attachments: KeyAttachments = {
    ...(withLabel ? { keyForLabel: vi.fn(async ({ label }: { label: string }) => rows.find(r => r.label === label)?.id ?? null) } : {}),
    keysFor: vi.fn().mockResolvedValue(granted),
    isAttached: vi.fn(async ({ keyId }: { keyId: string }) => granted.includes(keyId)),
    attach: vi.fn(), detach: vi.fn(), usersOf: vi.fn(), removeKey: vi.fn(), renameSite: vi.fn(),
  };
  const view = attachedOnlyVault({ vault, siteId: 'site', attachments, policy: { readonlyMessage: 'read only', report } });
  const { findOne, findDefault } = view;
  if (!findOne || !findDefault) throw new Error('granted view must offer findOne and findDefault');
  return { vault, attachments, view, report, findOne, findDefault };
}

it('granted find forwards the exact input and options to the owner vault', async () => {
  const { vault, view } = grantedView({ rows: [row('a')], granted: ['a'] });
  expect(await view.find({ workspaceId: 'project', id: 'a' }, {})).toEqual(row('a'));
  expect(vault.find).toHaveBeenCalledWith({ workspaceId: 'project', id: 'a' }, {});
});

it('a failing grant check is reported and reads as missing', async () => {
  const { attachments, view, report, vault } = grantedView({ rows: [row('a')], granted: ['a'] });
  const error = new Error('db down');
  vi.mocked(attachments.isAttached).mockRejectedValueOnce(error);
  expect(await view.find({ workspaceId: 'project', id: 'a' })).toBeNull();
  expect(report).toHaveBeenCalledWith({ kind: 'find', error });
  expect(vault.find).not.toHaveBeenCalled();
});

it('list returns only granted rows inside the query scope and skips vanished grants', async () => {
  const rows = [row('a'), row('b', { kind: 'vendor' }), row('c', { provider: 'p1' })];
  const { view, attachments } = grantedView({ rows, granted: ['a', 'b', 'c', 'gone'] });
  expect((await view.list({ workspaceId: 'project', kind: 'custom', ownerKey: 'owner', principalId: null })).map(r => r.id)).toEqual(['a', 'c']);
  expect((await view.list({ workspaceId: 'project', kind: 'custom', ownerKey: 'owner', principalId: null, provider: 'p1' })).map(r => r.id)).toEqual(['c']);
  expect(attachments.keysFor).toHaveBeenCalledWith({ siteId: 'site' });
});

it('a failing grant inventory is reported once and lists nothing', async () => {
  const { view, attachments, report } = grantedView({ rows: [row('a')], granted: ['a'] });
  vi.mocked(attachments.keysFor).mockRejectedValueOnce(new Error('db down'));
  expect(await view.list({ workspaceId: 'project', kind: 'custom', ownerKey: 'owner', principalId: null })).toEqual([]);
  expect(report).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith({ kind: 'list' });
});

it('findByLabel resolves a granted label, misses an unknown one, and reports a failing lookup', async () => {
  const { view, attachments, report } = grantedView({ rows: [row('a', { label: 'Mail' })], granted: ['a'] });
  expect(await view.findByLabel?.({ workspaceId: 'project', label: 'Mail' })).toEqual(row('a', { label: 'Mail' }));
  expect(attachments.keyForLabel).toHaveBeenCalledWith({ siteId: 'site', label: 'Mail' });
  expect(await view.findByLabel?.({ workspaceId: 'project', label: 'Nope' })).toBeNull();
  expect(attachments.isAttached).toHaveBeenCalledTimes(1);
  const error = new Error('index gone');
  vi.mocked(attachments.keyForLabel!).mockRejectedValueOnce(error);
  expect(await view.findByLabel?.({ workspaceId: 'project', label: 'Mail' })).toBeNull();
  expect(report).toHaveBeenCalledWith({ kind: 'label', error });
});

it('findByLabel is absent when the attachment store has no label index', () => {
  const { view } = grantedView({ rows: [], granted: [], withLabel: false });
  expect('findByLabel' in view).toBe(false);
});

it('findOne matches kind and only the owner/principal filters that were given', async () => {
  const rows = [row('a', { ownerKey: 'other' }), row('b', { principalId: 'p' }), row('c')];
  const { findOne } = grantedView({ rows, granted: ['a', 'b', 'c'] });
  expect((await findOne({ workspaceId: 'project', kind: 'custom' }))?.id).toBe('a');
  expect((await findOne({ workspaceId: 'project', kind: 'custom', ownerKey: 'owner' }))?.id).toBe('b');
  expect((await findOne({ workspaceId: 'project', kind: 'custom', ownerKey: 'owner', principalId: null }))?.id).toBe('c');
  expect(await findOne({ workspaceId: 'project', kind: 'vendor' })).toBeNull();
});

it('findDefault prefers the default row, falls back to a sole row, and refuses to guess between several', async () => {
  const query = { workspaceId: 'project', kind: 'custom' as const, ownerKey: 'owner', principalId: null, provider: null };
  expect((await grantedView({ rows: [row('a'), row('b', { isDefault: true })], granted: ['a', 'b'] }).findDefault(query))?.id).toBe('b');
  expect((await grantedView({ rows: [row('a')], granted: ['a'] }).findDefault(query))?.id).toBe('a');
  expect(await grantedView({ rows: [row('a'), row('b')], granted: ['a', 'b'] }).findDefault(query)).toBeNull();
  expect(await grantedView({ rows: [], granted: [] }).findDefault(query)).toBeNull();
});

it('every write is refused with the read-only message and never reaches the owner vault', async () => {
  const { view, vault } = grantedView({ rows: [row('a')], granted: ['a'] });
  const record = row('a');
  await expect(view.put({ record, expectedRevision: null })).rejects.toThrow('read only');
  await expect(view.patchMeta({ workspaceId: 'project', id: 'a', expectedRevision: 1, patch: {}, updatedAt: '' })).rejects.toThrow('read only');
  await expect(view.delete({ workspaceId: 'project', id: 'a', expectedRevision: 1 })).rejects.toThrow('read only');
  await expect(view.applyBatch!({ ops: [] })).rejects.toThrow('read only');
  expect(vault.put).not.toHaveBeenCalled();
  expect(vault.delete).not.toHaveBeenCalled();
});
