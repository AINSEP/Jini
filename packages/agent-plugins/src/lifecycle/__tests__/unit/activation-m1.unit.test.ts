import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { ACTIVATIONS_FILENAME, createActivationModule } from '../../activation.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

it('distinguishes an operator disable from absence, an enabled entry, and an untouched seed', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'activation-m1-'));
  const api = createActivationModule({ ...ports });
  try {
    expect(await api.isAgentPluginDisabledByOperator(workspaceRoot, 'plugin')).toBe(false);
    await api.setAgentPluginActivation({ workspaceRoot, pluginId: 'plugin', enabled: false, actor: 'system:seed' });
    expect(await api.isAgentPluginDisabledByOperator(workspaceRoot, 'plugin')).toBe(false);
    await api.setAgentPluginActivation({ workspaceRoot, pluginId: 'plugin', enabled: false, actor: 'operator:alice' });
    expect(await api.isAgentPluginDisabledByOperator(workspaceRoot, 'plugin')).toBe(true);
    await api.setAgentPluginActivation({ workspaceRoot, pluginId: 'plugin', enabled: true, actor: 'operator:alice' });
    expect(await api.isAgentPluginDisabledByOperator(workspaceRoot, 'plugin')).toBe(false);
  } finally { await forceRemove(workspaceRoot); }
});

it('reconciliation treats an absent activation as enabled and writes only a real transition', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'activation-reconcile-m1-'));
  const api = createActivationModule({ ...ports });
  const input = { workspaceRoot, pluginId: 'mirror', actor: 'system:mirror' };
  try {
    expect(await api.reconcileAgentPluginActivation({ ...input, resolveEnabled: async () => true })).toBe(false);
    await expect(readFile(path.join(workspaceRoot, ACTIVATIONS_FILENAME))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await api.reconcileAgentPluginActivation({ ...input, resolveEnabled: async () => false })).toBe(true);
    expect((await api.readAgentPluginActivations(workspaceRoot)).plugins.mirror)
      .toMatchObject({ enabled: false, updatedBy: 'system:mirror' });
    expect(await api.reconcileAgentPluginActivation({ ...input, resolveEnabled: async () => false })).toBe(false);
  } finally { await forceRemove(workspaceRoot); }
});
