import { expect, it, vi } from 'vitest';
import type { KeyAttachments } from '@jini-ai/core/contracts/site/project-key-attachments';
import type { VaultRepoPort } from '@jini-ai/core/contracts/vault';
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
