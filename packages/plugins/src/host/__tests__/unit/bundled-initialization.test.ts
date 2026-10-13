import { describe, expect, it } from 'vitest';
import { initializeBundledPlugins } from '../../bundled-initialization.js';
import { InMemoryPluginActivationRepo } from '../../repo.memory.js';
import type { PluginDiscoveryRecord } from '../../discovery-types.js';

const record = (id: string): PluginDiscoveryRecord => ({ id, name: id, version: '1.0.0', source: 'built-in', status: 'valid', errors: [] });
describe('absent-row-only bundled initializer', () => {
  it('preserves disabled, enabled and quarantined rows; repeated ids and boots load once', async () => {
    const prior = ['disabled', 'enabled', 'quarantined'].map((pluginId) => ({ pluginId, workspaceId: 'w', version: '0.9.0', enabled: pluginId === 'enabled', updatedAt: 'old',
      ...(pluginId === 'quarantined' ? { quarantinedAt: 'old', quarantineReason: 'failure' } : {}),
    }));
    const repo = new InMemoryPluginActivationRepo({ initialRows: prior });
    const loads: string[] = [];
    const deps = { repo, clock: { nowMs: () => 0 }, discovery: [...prior.map(({ pluginId }) => record(pluginId)), record('new')], onEnabled: async (id: string) => { loads.push(id); } };
    const input = { workspaceId: 'w', pluginIds: ['disabled', 'enabled', 'quarantined', 'new', 'new'] };
    expect(await initializeBundledPlugins({ deps, input })).toEqual({ enabled: ['new'], skipped: ['disabled', 'enabled', 'quarantined'], failed: [] });
    await initializeBundledPlugins({ deps, input });
    expect(loads).toEqual(['new']);
    for (const row of prior) expect(await repo.getActivation({ workspaceId: 'w', pluginId: row.pluginId })).toEqual(row);
  });

  it('keeps boot usable after a load failure and uses activation compensation', async () => {
    const repo = new InMemoryPluginActivationRepo();
    const error = new Error('bad bundle');
    const result = await initializeBundledPlugins({ deps: { repo, clock: { nowMs: () => 0 }, discovery: [record('bad'), record('good')], onEnabled: async (id) => { if (id === 'bad') throw error; } }, input: { workspaceId: 'w', pluginIds: ['bad', 'good'] } });
    expect(result).toEqual({ enabled: ['good'], skipped: [], failed: [{ pluginId: 'bad', error }] });
    expect(await repo.getActivation({ workspaceId: 'w', pluginId: 'bad' })).toBeNull();
  });
});
