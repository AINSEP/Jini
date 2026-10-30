import { expect, it, vi } from 'vitest';
import { quarantinePlugin } from '../../quarantine.js';
import { InMemoryPluginActivationRepo } from '../support/repo.memory.js';

it('notifies only the first committed quarantine and keeps the write when its observer throws', async () => {
  const repo = new InMemoryPluginActivationRepo([{ pluginId: 'plugin', workspaceId: 'w', version: '1.0.0',
    enabled: true, updatedAt: '2026-01-01T00:00:00.000Z' }]);
  const onQuarantined = vi.fn(() => { throw new Error('observer failed'); });
  const deps = { repo, clock: { nowMs: () => Date.parse('2026-10-29T00:00:00.000Z') }, onQuarantined };
  const input = { pluginId: 'plugin', workspaceId: 'w', reason: 'hook timed out', consecutiveFailures: 3 };
  const first = await quarantinePlugin({ deps, input });
  expect(await repo.getActivation({ pluginId: 'plugin', workspaceId: 'w' })).toEqual(first.activation);
  expect(first.activation).toEqual({ pluginId: 'plugin', workspaceId: 'w', version: '1.0.0', enabled: false,
    updatedAt: '2026-10-29T00:00:00.000Z', quarantinedAt: '2026-10-29T00:00:00.000Z',
    quarantineReason: 'hook timed out', quarantineFailureCount: 3 });
  expect(onQuarantined).toHaveBeenCalledTimes(1);
  expect(onQuarantined).toHaveBeenCalledWith({ pluginId: 'plugin', workspaceId: 'w' }, {});
  await quarantinePlugin({ deps, input: { ...input, consecutiveFailures: 4, reason: 'still failing' } });
  expect(onQuarantined).toHaveBeenCalledTimes(1);
  expect(await repo.getActivation({ pluginId: 'plugin', workspaceId: 'w' }))
    .toMatchObject({ enabled: false, quarantineReason: 'still failing', quarantineFailureCount: 4 });
});

it('does not announce a quarantine that failed to persist', async () => {
  const repo = new InMemoryPluginActivationRepo([{ pluginId: 'plugin', workspaceId: 'w', version: '1.0.0',
    enabled: true, updatedAt: 'original' }]);
  const failure = new Error('store unavailable');
  vi.spyOn(repo, 'save').mockRejectedValueOnce(failure);
  const onQuarantined = vi.fn();
  await expect(quarantinePlugin({ deps: { repo, clock: { nowMs: () => 0 }, onQuarantined },
    input: { pluginId: 'plugin', workspaceId: 'w', reason: 'failure', consecutiveFailures: 3 },
  })).rejects.toBe(failure);
  expect(onQuarantined).not.toHaveBeenCalled();
  expect(await repo.getActivation({ pluginId: 'plugin', workspaceId: 'w' })).toEqual({
    pluginId: 'plugin', workspaceId: 'w', version: '1.0.0', enabled: true, updatedAt: 'original',
  });
});

it('leaves settings untouched when a provider has no migrations or an absent-value rule does not opt in', () => {
  // Migration assertions live beside the quarantine tests to keep this gap-fill batch independent
  // of the concurrently edited provider-host suites.
  return import('../../provider-settings-migrations.js').then(({ migrateProviderSettings }) => {
    const settings = { token: 'keep', mode: 'current' };
    expect(migrateProviderSettings({ providers: [{ contract: 'fixture', id: 'fixture', contractVersion: 1 }], settings }))
      .toEqual(settings);
    expect(migrateProviderSettings({ providers: [{ contract: 'fixture', id: 'fixture', contractVersion: 1,
      settingsMigrations: [{ when: { field: 'missing', in: ['old'] }, set: { mode: 'replaced' } }],
    }], settings })).toEqual({ token: 'keep', mode: 'current' });
    expect(settings).toEqual({ token: 'keep', mode: 'current' });
  });
});
