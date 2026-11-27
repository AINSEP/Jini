import { expect, test, vi } from 'vitest';
import { createMailProviderRegistry } from '@jini-ai/platform/mail';
import type { MailProviderModule, MailProviderSetting } from '@jini-ai/core/contracts/mail';
import { createMailSelection, type MailSelectionInput, type MailSelectionPorts } from '../selection.js';
import { createHostMailer } from '../host-mailer.js';

const input = { pluginId: 'dispatch', enabled: false, actor: 'admin-41' };
const conflict = new Error('settings revision conflict');
const unauthorized = new Error('settings write refused');
const mailProvider = (id: string): MailProviderModule => ({
  id, label: id, credentialKeys: [],
  capabilities: { hosted: true, feedback: false, domainVerification: false },
  create: () => { throw new Error('not a mail-send test'); },
});

function fixture({ active = true, setting = { transactional: 'relay', bulk: 'bulk' } }: {
  active?: boolean; setting?: MailProviderSetting;
} = {}) {
  let current = { setting, revisionSeq: 17 };
  let owner: string | undefined = active ? 'dispatch' : undefined;
  let durableEnabled = active;
  let effectiveSelection = setting;
  const catalog = () => {
    const registry = createMailProviderRegistry({}, { builtins: [mailProvider('bulk')] });
    if (owner) registry.contribute({ pluginId: owner, definition: { id: 'relay', provider: mailProvider('relay') } });
    return { registry, pluginIds: owner ? ['relay'] : [], refusals: [], credentialLabelFor: () => undefined, setupFor: () => ({ fields: [] }) };
  };
  const writeSelection = vi.fn<MailSelectionPorts<MailSelectionInput, { enabled: boolean }>['writeSelection']>(async ({ value, expectedRevisionSeq }) => {
    if (expectedRevisionSeq !== current.revisionSeq) throw conflict;
    current = { setting: value, revisionSeq: current.revisionSeq + 1 };
  });
  const invalidate = vi.fn(() => { effectiveSelection = current.setting; });
  const installedProviderIds = vi.fn(async (request: MailSelectionInput) => {
    if (request.pluginId !== 'dispatch') throw new Error('wrong plugin');
    return ['relay', 'bulk'];
  });
  const toggle = vi.fn(async ({ pluginId, enabled }: MailSelectionInput) => {
    if (pluginId !== 'dispatch') throw new Error('wrong activation');
    durableEnabled = enabled;
    if (owner === 'dispatch' || enabled) owner = enabled ? 'dispatch' : undefined;
    return { pluginId, enabled };
  });
  const selection = {
    ready: async () => {}, loadCatalog: async () => catalog(), readSelection: async () => current,
    writeSelection, installedProviderIds, toggle, isRevisionConflict: (error: unknown) => error === conflict,
  };
  const revisionEdit = (value: MailProviderSetting, newOwner?: string) => {
    current = { setting: value, revisionSeq: current.revisionSeq + 1 };
    owner = newOwner;
  };
  return {
    selection, revisionEdit, invalidate, current: () => current, readActive: () => effectiveSelection, isEnabled: () => durableEnabled,
    ...createMailSelection({ ...selection, invalidate, mailerReady: Promise.resolve() }),
  };
}

test('disabling clears only the selected lane owned by that plugin and refreshes the live choice', async () => {
  const f = fixture();
  await expect(f.setAgentPluginEnabled(input)).resolves.toEqual({ pluginId: 'dispatch', enabled: false });
  expect(f.isEnabled()).toBe(false);
  expect(f.selection.toggle.mock.calls).toEqual([[input]]);
  expect(f.selection.installedProviderIds.mock.calls).toEqual([]);
  expect(f.selection.writeSelection.mock.calls).toEqual([[{
    principalId: 'admin-41', value: { transactional: null, bulk: 'bulk' }, expectedRevisionSeq: 17,
  }]]);
  expect(f.readActive()).toEqual({ transactional: null, bulk: 'bulk' });
});

test('on a revision conflict, rereads selection and preserves the newer choice in the other lane', async () => {
  const f = fixture();
  f.selection.writeSelection.mockImplementationOnce(async () => {
    f.revisionEdit({ transactional: 'relay', bulk: null });
    throw conflict;
  });
  await f.setAgentPluginEnabled(input);
  expect(f.selection.writeSelection.mock.calls).toEqual([
    [{ principalId: 'admin-41', value: { transactional: null, bulk: 'bulk' }, expectedRevisionSeq: 17 }],
    [{ principalId: 'admin-41', value: { transactional: null, bulk: null }, expectedRevisionSeq: 18 }],
  ]);
  expect(f.readActive()).toEqual({ transactional: null, bulk: null });
});

test('retry does not clear an id now owned by another plugin', async () => {
  const f = fixture();
  f.selection.writeSelection.mockImplementationOnce(async () => {
    f.revisionEdit({ transactional: 'relay', bulk: 'bulk' }, 'other-owner');
    throw conflict;
  });
  await f.setAgentPluginEnabled(input);
  expect(f.selection.writeSelection.mock.calls).toEqual([[{
    principalId: 'admin-41', value: { transactional: null, bulk: 'bulk' }, expectedRevisionSeq: 17,
  }]]);
  expect(f.current()).toEqual({ setting: { transactional: 'relay', bulk: 'bulk' }, revisionSeq: 18 });
  expect(f.readActive()).toEqual({ transactional: 'relay', bulk: 'bulk' });
});

test('caps conflict retries and can finish an interrupted disable on a later call', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) f.selection.writeSelection.mockRejectedValueOnce(conflict);
  await expect(f.setAgentPluginEnabled(input)).rejects.toBe(conflict);
  expect(f.selection.writeSelection.mock.calls).toEqual(Array.from({ length: 3 }, () => [{
    principalId: 'admin-41', value: { transactional: null, bulk: 'bulk' }, expectedRevisionSeq: 17,
  }]));
  expect(f.isEnabled()).toBe(false);
  expect(f.readActive()).toEqual({ transactional: 'relay', bulk: 'bulk' });
  await f.setAgentPluginEnabled(input);
  expect(f.selection.installedProviderIds.mock.calls).toEqual([]);
  expect(f.readActive()).toEqual({ transactional: null, bulk: 'bulk' });
});

test('with no live or cached ownership, clears only orphaned provider ids from the installed declaration', async () => {
  const f = fixture({ active: false });
  await f.setAgentPluginEnabled(input);
  expect(f.selection.installedProviderIds.mock.calls).toEqual([[input]]);
  expect(f.readActive()).toEqual({ transactional: null, bulk: 'bulk' });
});

test('does not consult inactive declarations when all selected lanes still resolve or the plugin is being enabled', async () => {
  const f = fixture({ active: false, setting: { transactional: null, bulk: 'bulk' } });
  await f.setAgentPluginEnabled(input);
  await f.setAgentPluginEnabled({ ...input, enabled: true });
  expect(f.selection.installedProviderIds.mock.calls).toEqual([]);
  expect(f.selection.writeSelection.mock.calls).toEqual([]);
  expect(f.isEnabled()).toBe(true);
  expect(f.readActive()).toEqual({ transactional: null, bulk: 'bulk' });
});

test('host facade waits for boot mail readiness before persisting a selection and then invalidates its own cache', async () => {
  const f = fixture();
  let finishMailBoot!: () => void;
  const mailBoot = new Promise<void>(resolve => { finishMailBoot = resolve; });
  let readyCalled!: () => void;
  const readyReached = new Promise<void>(resolve => { readyCalled = resolve; });
  const operations = { status: f.readActive };
  const host = createHostMailer({
    resolved: { ready: mailBoot, invalidate: f.invalidate },
    operations, selection: { ...f.selection, ready: async () => { readyCalled(); } },
  });
  const choosing = host.selectProvider({ id: 'relay', principalId: 'person-2', expectedRevisionSeq: 17 });
  await readyReached;
  expect(f.selection.writeSelection.mock.calls).toEqual([]);
  expect(host.operations.status()).toEqual({ transactional: 'relay', bulk: 'bulk' });
  finishMailBoot();
  await choosing;
  expect(f.selection.writeSelection.mock.calls).toEqual([[{
    principalId: 'person-2', value: { transactional: 'relay', bulk: 'relay' }, expectedRevisionSeq: 17,
  }]]);
  expect(host.operations.status()).toEqual({ transactional: 'relay', bulk: 'relay' });
});

test('a refused settings write propagates without changing the live choice or retrying a non-conflict', async () => {
  const f = fixture();
  f.selection.writeSelection.mockRejectedValueOnce(unauthorized);
  await expect(f.selectProvider({ id: 'bulk', principalId: 'unprivileged', expectedRevisionSeq: 17 })).rejects.toBe(unauthorized);
  expect(f.invalidate.mock.calls).toEqual([]);
  expect(f.readActive()).toEqual({ transactional: 'relay', bulk: 'bulk' });

  f.selection.writeSelection.mockRejectedValueOnce(unauthorized);
  await expect(f.setAgentPluginEnabled(input)).rejects.toBe(unauthorized);
  expect(f.selection.writeSelection.mock.calls).toHaveLength(2);
  expect(f.invalidate.mock.calls).toEqual([[]]);
  expect(f.readActive()).toEqual({ transactional: 'relay', bulk: 'bulk' });
});
