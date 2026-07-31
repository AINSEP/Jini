import { describe, expect, it, vi } from 'vitest';
import { createFakeSourceConfigDependencies, createFakeSourceConfigPort } from '../../../features/source-config-list/dependencies.js';
import type { SourceConfigItem } from '../../../features/source-config-list/types.js';

function createSource(input: { fields: Record<string, string>; trust?: string }): SourceConfigItem {
  const id = `id-${input.fields.url ?? input.fields.apiKey ?? 'x'}`;
  return input.trust !== undefined
    ? { id, fields: input.fields, trust: input.trust }
    : { id, fields: input.fields };
}

describe('createFakeSourceConfigPort', () => {
  it('fetchSources returns a snapshot copy of the seeded sources', async () => {
    const seed: SourceConfigItem = { id: 'a', fields: { url: 'https://a.example' } };
    const port = createFakeSourceConfigPort({ sources: [seed], createSource });
    const fetched = await port.fetchSources();
    expect(fetched).toEqual([seed]);
    expect(fetched).not.toBe(port); // sanity: not the same reference chain as internal store
  });

  it('fetchSources on an unseeded port returns an empty list', async () => {
    const port = createFakeSourceConfigPort({ createSource });
    expect(await port.fetchSources()).toEqual([]);
  });

  it('addSource appends via createSource and returns ok:true with the created source', async () => {
    const port = createFakeSourceConfigPort({ createSource });
    const result = await port.addSource({ fields: { url: 'https://new.example' } });
    expect(result.ok).toBe(true);
    expect(result.source?.fields.url).toBe('https://new.example');
    expect(await port.fetchSources()).toHaveLength(1);
  });

  it('addSource persists the trust value from the input', async () => {
    const port = createFakeSourceConfigPort({ createSource });
    const result = await port.addSource({ fields: { url: 'https://new.example' }, trust: 'trusted' });
    expect(result.source?.trust).toBe('trusted');
  });

  it('removeSource removes an existing id and returns true', async () => {
    const seed: SourceConfigItem = { id: 'a', fields: {} };
    const port = createFakeSourceConfigPort({ sources: [seed], createSource });
    expect(await port.removeSource('a')).toBe(true);
    expect(await port.fetchSources()).toEqual([]);
  });

  it('removeSource returns false for an unknown id and leaves the store untouched', async () => {
    const seed: SourceConfigItem = { id: 'a', fields: {} };
    const port = createFakeSourceConfigPort({ sources: [seed], createSource });
    expect(await port.removeSource('zzz')).toBe(false);
    expect(await port.fetchSources()).toEqual([seed]);
  });

  it('respects a configured latencyMs by resolving asynchronously', async () => {
    vi.useFakeTimers();
    try {
      const port = createFakeSourceConfigPort({ createSource, latencyMs: 50 });
      const promise = port.fetchSources();
      let resolved = false;
      void promise.then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(50);
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('optional refresh/trust/test/update capabilities', () => {
    it('are wired by default', () => {
      const port = createFakeSourceConfigPort({ createSource });
      expect(port.refreshSource).toBeInstanceOf(Function);
      expect(port.setTrust).toBeInstanceOf(Function);
      expect(port.testSource).toBeInstanceOf(Function);
      expect(port.updateSource).toBeInstanceOf(Function);
    });

    it('are omitted entirely when disabled, matching a source shape with no such concept', () => {
      const port = createFakeSourceConfigPort({
        createSource,
        supportsRefresh: false,
        supportsTrust: false,
        supportsTest: false,
        supportsUpdate: false,
      });
      expect(port.refreshSource).toBeUndefined();
      expect(port.setTrust).toBeUndefined();
      expect(port.testSource).toBeUndefined();
      expect(port.updateSource).toBeUndefined();
    });

    it('refreshSource defaults to returning the stored source unchanged', async () => {
      const seed: SourceConfigItem = { id: 'a', fields: { url: 'https://a.example' } };
      const port = createFakeSourceConfigPort({ sources: [seed], createSource });
      const refreshed = await port.refreshSource!('a');
      expect(refreshed).toEqual(seed);
    });

    it('refreshSource applies a custom onRefresh transform', async () => {
      const seed: SourceConfigItem = { id: 'a', fields: {}, statusMessage: 'stale' };
      const port = createFakeSourceConfigPort({
        sources: [seed],
        createSource,
        onRefresh: (source) => ({ ...source, statusMessage: 'fresh' }),
      });
      const refreshed = await port.refreshSource!('a');
      expect(refreshed?.statusMessage).toBe('fresh');
      expect((await port.fetchSources())[0]?.statusMessage).toBe('fresh');
    });

    it('refreshSource returns null for an unknown id', async () => {
      const port = createFakeSourceConfigPort({ createSource });
      expect(await port.refreshSource!('zzz')).toBeNull();
    });

    it('setTrust updates and persists the trust value', async () => {
      const seed: SourceConfigItem = { id: 'a', fields: {}, trust: 'restricted' };
      const port = createFakeSourceConfigPort({ sources: [seed], createSource });
      const updated = await port.setTrust!('a', 'official');
      expect(updated?.trust).toBe('official');
      expect((await port.fetchSources())[0]?.trust).toBe('official');
    });

    it('setTrust returns null for an unknown id', async () => {
      const port = createFakeSourceConfigPort({ createSource });
      expect(await port.setTrust!('zzz', 'trusted')).toBeNull();
    });

    it('testSource defaults to an always-ok result', async () => {
      const seed: SourceConfigItem = { id: 'a', fields: {} };
      const port = createFakeSourceConfigPort({ sources: [seed], createSource });
      const result = await port.testSource!('a');
      expect(result.ok).toBe(true);
    });

    it('testSource passes the draft and matched source through to a custom onTest', async () => {
      const seed: SourceConfigItem = { id: 'a', fields: { url: 'https://old.example' } };
      const onTest = vi.fn().mockReturnValue({ ok: false, message: 'boom' });
      const port = createFakeSourceConfigPort({ sources: [seed], createSource, onTest });
      const result = await port.testSource!('a', { url: 'https://draft.example' });
      expect(onTest).toHaveBeenCalledWith('a', { url: 'https://draft.example' }, seed);
      expect(result).toEqual({ ok: false, message: 'boom' });
    });

    it('testSource resolves source to undefined when testing an unsaved draft (id undefined)', async () => {
      const onTest = vi.fn().mockReturnValue({ ok: true });
      const port = createFakeSourceConfigPort({ createSource, onTest });
      await port.testSource!(undefined, { apiKey: 'sk-draft' });
      expect(onTest).toHaveBeenCalledWith(undefined, { apiKey: 'sk-draft' }, undefined);
    });

    it('updateSource defaults to a shallow merge of label/enabled/fields onto the stored source', async () => {
      const seed: SourceConfigItem = { id: 'a', label: 'Old', enabled: true, fields: { url: 'https://old.example', extra: 'kept' } };
      const port = createFakeSourceConfigPort({ sources: [seed], createSource });
      const updated = await port.updateSource!('a', { label: 'New', enabled: false, fields: { url: 'https://new.example' } });
      expect(updated).toEqual({ id: 'a', label: 'New', enabled: false, fields: { url: 'https://new.example', extra: 'kept' } });
      expect((await port.fetchSources())[0]).toEqual(updated);
    });

    it('updateSource leaves label/enabled/fields untouched when the patch omits them', async () => {
      const seed: SourceConfigItem = { id: 'a', label: 'Old', enabled: true, fields: { url: 'https://old.example' } };
      const port = createFakeSourceConfigPort({ sources: [seed], createSource });
      const updated = await port.updateSource!('a', {});
      expect(updated).toEqual(seed);
    });

    it('updateSource applies a custom onUpdate transform', async () => {
      const seed: SourceConfigItem = { id: 'a', fields: {} };
      const onUpdate = vi.fn().mockReturnValue({ id: 'a', fields: {}, statusMessage: 'custom-merged' });
      const port = createFakeSourceConfigPort({ sources: [seed], createSource, onUpdate });
      const updated = await port.updateSource!('a', { label: 'New' });
      expect(onUpdate).toHaveBeenCalledWith(seed, { label: 'New' });
      expect(updated?.statusMessage).toBe('custom-merged');
    });

    it('updateSource returns null for an unknown id and leaves the store untouched', async () => {
      const seed: SourceConfigItem = { id: 'a', fields: {} };
      const port = createFakeSourceConfigPort({ sources: [seed], createSource });
      expect(await port.updateSource!('zzz', { label: 'New' })).toBeNull();
      expect(await port.fetchSources()).toEqual([seed]);
    });
  });
});

describe('createFakeSourceConfigDependencies', () => {
  it('wraps the fake port under { port }', async () => {
    const deps = createFakeSourceConfigDependencies({ createSource });
    expect(deps.port).toBeDefined();
    expect(await deps.port.fetchSources()).toEqual([]);
  });
});
