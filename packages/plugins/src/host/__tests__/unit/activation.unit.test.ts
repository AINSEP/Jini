import { describe, expect, it } from 'vitest';
import {
  getActivation, PluginIncompatibleError, PluginInvalidError, PluginNotFoundError, setPluginEnabled,
  type PluginActivationRecord, type PluginActivationRepoPort, type SetPluginEnabledDeps,
} from '../../activation.js';
import type { PluginDiscoveryRecord } from '../../discovery-types.js';
import { InMemoryPluginActivationRepo } from '../support/repo.memory.js';

const NOW = '2026-10-21T08:00:00.000Z';
const clock = { nowMs: () => Date.parse(NOW) };
const target = { workspaceId: 'ws-1', pluginId: 'example' };
const record = (status: PluginDiscoveryRecord['status'], version = '2.0.0'): PluginDiscoveryRecord =>
  ({ id: 'example', name: 'Example', version, source: 'site', status, errors: [] });
const prior: PluginActivationRecord = { ...target, version: '1.0.0', enabled: true, updatedAt: '2026-01-01T00:00:00.000Z' };

function deps(overrides: Omit<Partial<SetPluginEnabledDeps>, 'repo'> = {}, rows: PluginActivationRecord[] = []) {
  return { clock, repo: new InMemoryPluginActivationRepo(rows), discovery: [record('valid')], ...overrides };
}

describe('setPluginEnabled preconditions', () => {
  it('refuses an id missing from the discovery snapshot', async () => {
    await expect(setPluginEnabled({ deps: deps({ discovery: [] }), input: { ...target, enabled: false } }))
      .rejects.toThrow(new PluginNotFoundError("plugin 'example' was not found in the current discovery snapshot"));
  });

  it.each([
    ['incompatible', PluginIncompatibleError, "plugin 'example' is incompatible with this runtime's SDK version"],
    ['invalid', PluginInvalidError, "plugin 'example' failed validation and cannot be enabled"],
  ] as const)('refuses to enable an %s plugin without writing anything', async (status, ErrorType, message) => {
    const d = deps({ discovery: [record(status)] });
    const failure = await setPluginEnabled({ deps: d, input: { ...target, enabled: true } }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ErrorType);
    expect((failure as Error).message).toBe(message);
    expect(await d.repo.listAll()).toEqual([]);
  });

  it('still disables a plugin that has since become invalid', async () => {
    const d = deps({ discovery: [record('invalid')] }, [prior]);
    const { activation } = await setPluginEnabled({ deps: d, input: { ...target, enabled: false } });
    expect(activation).toEqual({ ...target, version: '1.0.0', enabled: false, updatedAt: NOW });
  });
});

describe('setPluginEnabled transitions', () => {
  it('an enable advances the active pointer to the discovered version and runs the load side effect', async () => {
    const loaded: string[] = [];
    const d = deps({ onEnabled: async (id) => { loaded.push(id); } }, [prior]);
    const { activation } = await setPluginEnabled({ deps: d, input: { ...target, enabled: true } });
    expect(activation).toEqual({ ...target, version: '2.0.0', enabled: true, updatedAt: NOW });
    expect(await d.repo.getActivation(target)).toEqual(activation);
    expect(loaded).toEqual(['example']);
  });

  it('a first-time disable with no prior row records the discovered version and runs the detach side effect', async () => {
    const detached: string[] = [];
    const d = deps({ onDisabled: (id) => { detached.push(id); } });
    const { activation } = await setPluginEnabled({ deps: d, input: { ...target, enabled: false } });
    expect(activation.version).toBe('2.0.0');
    expect(detached).toEqual(['example']);
  });

  it('works with no side-effect hooks at all', async () => {
    const d = deps();
    await setPluginEnabled({ deps: d, input: { ...target, enabled: true } });
    await setPluginEnabled({ deps: d, input: { ...target, enabled: false } });
    expect(await d.repo.getActivation(target)).toMatchObject({ enabled: false, version: '2.0.0' });
  });
});

describe('setPluginEnabled side-effect failure compensation', () => {
  it('restores the prior row when the enable side effect fails, and rethrows the original error', async () => {
    const failure = new Error('load failed');
    const d = deps({ onEnabled: async () => { throw failure; } }, [prior]);
    await expect(setPluginEnabled({ deps: d, input: { ...target, enabled: true } })).rejects.toBe(failure);
    expect(await d.repo.getActivation(target)).toEqual(prior);
  });

  it('deletes the row it just created when a first-time disable side effect fails', async () => {
    const failure = new Error('detach failed');
    const d = deps({ onDisabled: () => { throw failure; } });
    await expect(setPluginEnabled({ deps: d, input: { ...target, enabled: false } })).rejects.toBe(failure);
    expect(await d.repo.getActivation(target)).toBeNull();
  });

  it('never lets a failing compensation mask the original side-effect error', async () => {
    const failure = new Error('load failed');
    const inner = new InMemoryPluginActivationRepo([prior]);
    let saves = 0;
    const repo: PluginActivationRepoPort = {
      getActivation: (required) => inner.getActivation(required),
      save: async (row) => { saves += 1; if (saves > 1) throw new Error('compensation write failed'); await inner.save(row); },
      deleteActivation: (required) => inner.deleteActivation(required),
      listAll: () => inner.listAll(),
    };
    await expect(setPluginEnabled({ deps: { clock, repo, discovery: [record('valid')], onEnabled: async () => { throw failure; } },
      input: { ...target, enabled: true } })).rejects.toBe(failure);
    expect(saves).toBe(2);
  });
});

describe('getActivation', () => {
  it('returns the stored row, or null for a plugin that was never turned on', async () => {
    const repo = new InMemoryPluginActivationRepo([prior]);
    expect(await getActivation({ deps: { repo }, input: target })).toEqual(prior);
    expect(await getActivation({ deps: { repo }, input: { ...target, pluginId: 'other' } })).toBeNull();
  });
});
