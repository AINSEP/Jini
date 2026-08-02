import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSourceConfigList, useWiredSourceConfigList } from './useSourceConfigList.js';
import type { SourceConfigPort } from '../../ports.js';
import type { SourceConfigItem } from '../../types.js';

function fakePort(overrides: Partial<SourceConfigPort<SourceConfigItem>> = {}): SourceConfigPort<SourceConfigItem> {
  return {
    fetchSources: vi.fn().mockResolvedValue([]),
    addSource: vi.fn(),
    removeSource: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const SEED: SourceConfigItem = { id: 'a', fields: { url: 'https://a.example' }, trust: 'restricted' };

describe('useSourceConfigList', () => {
  it('loads sources on mount', async () => {
    const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]) });
    const { result } = renderHook(() => useSourceConfigList({ port }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sources).toEqual([SEED]);
    expect(result.current.error).toBeNull();
  });

  it('sets an error when the initial load rejects', async () => {
    const port = fakePort({ fetchSources: vi.fn().mockRejectedValue(new Error('network down')) });
    const { result } = renderHook(() => useSourceConfigList({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load sources.');
    expect(result.current.sources).toEqual([]);
  });

  it('reload() re-fetches and clears a prior error', async () => {
    const fetchSources = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([SEED]);
    const port = fakePort({ fetchSources });
    const { result } = renderHook(() => useSourceConfigList({ port }));
    await waitFor(() => expect(result.current.error).toBe('Failed to load sources.'));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.sources).toEqual([SEED]);
  });

  it('derives capabilities from which optional port methods are present', async () => {
    const fullPort = fakePort({ refreshSource: vi.fn(), setTrust: vi.fn(), testSource: vi.fn(), updateSource: vi.fn() });
    const { result: full } = renderHook(() => useSourceConfigList({ port: fullPort }));
    await waitFor(() => expect(full.current.loading).toBe(false));
    expect(full.current.capabilities).toEqual({ canRefresh: true, canSetTrust: true, canTest: true, canUpdate: true });

    const minimalPort = fakePort();
    const { result: minimal } = renderHook(() => useSourceConfigList({ port: minimalPort }));
    await waitFor(() => expect(minimal.current.loading).toBe(false));
    expect(minimal.current.capabilities).toEqual({ canRefresh: false, canSetTrust: false, canTest: false, canUpdate: false });
  });

  it('addSourceToList upserts a source into the in-memory list without a reload', async () => {
    const port = fakePort();
    const { result } = renderHook(() => useSourceConfigList({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.addSourceToList(SEED));
    expect(result.current.sources).toEqual([SEED]);
  });

  describe('remove', () => {
    it('removes the source on success and tracks pending only during the call', async () => {
      const removeSource = vi.fn().mockResolvedValue(true);
      const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]), removeSource });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));

      await act(async () => {
        await result.current.remove('a');
      });
      expect(removeSource).toHaveBeenCalledWith('a');
      expect(result.current.sources).toEqual([]);
      expect(result.current.isPending('a', 'remove')).toBe(false);
    });

    it('leaves the list unchanged when the port reports failure', async () => {
      const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]), removeSource: vi.fn().mockResolvedValue(false) });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      await act(async () => {
        await result.current.remove('a');
      });
      expect(result.current.sources).toEqual([SEED]);
    });

    it('clears the pending flag even when the port call throws', async () => {
      const port = fakePort({
        fetchSources: vi.fn().mockResolvedValue([SEED]),
        removeSource: vi.fn().mockRejectedValue(new Error('boom')),
      });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      await act(async () => {
        await expect(result.current.remove('a')).rejects.toThrow('boom');
      });
      expect(result.current.isPending('a', 'remove')).toBe(false);
    });
  });

  describe('refresh', () => {
    it('is a no-op when the port has no refreshSource', async () => {
      const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]) });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      await act(async () => {
        await result.current.refresh('a');
      });
      expect(result.current.sources).toEqual([SEED]);
    });

    it('updates the source with the refreshed value on success', async () => {
      const refreshed: SourceConfigItem = { ...SEED, statusMessage: 'fresh' };
      const port = fakePort({
        fetchSources: vi.fn().mockResolvedValue([SEED]),
        refreshSource: vi.fn().mockResolvedValue(refreshed),
      });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      await act(async () => {
        await result.current.refresh('a');
      });
      expect(result.current.sources[0]?.statusMessage).toBe('fresh');
    });

    it('leaves the list unchanged when the port returns null', async () => {
      const port = fakePort({
        fetchSources: vi.fn().mockResolvedValue([SEED]),
        refreshSource: vi.fn().mockResolvedValue(null),
      });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      await act(async () => {
        await result.current.refresh('a');
      });
      expect(result.current.sources).toEqual([SEED]);
    });
  });

  describe('setTrust', () => {
    it('is a no-op when the port has no setTrust', async () => {
      const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]) });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      await act(async () => {
        await result.current.setTrust('a', 'trusted');
      });
      expect(result.current.sources[0]?.trust).toBe('restricted');
    });

    it('updates the source trust on success', async () => {
      const updated: SourceConfigItem = { ...SEED, trust: 'official' };
      const port = fakePort({
        fetchSources: vi.fn().mockResolvedValue([SEED]),
        setTrust: vi.fn().mockResolvedValue(updated),
      });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      await act(async () => {
        await result.current.setTrust('a', 'official');
      });
      expect(result.current.sources[0]?.trust).toBe('official');
    });
  });

  describe('update', () => {
    /**
     * Regression for the audit finding that MCP-shaped enable/edit behavior
     * (real OD `McpClientSection.tsx`'s `McpRow` enable toggle and
     * expand-to-edit label/field inputs) was declared in `types.ts`
     * (`SourceConfigItem.enabled`) but never actually mutable anywhere —
     * `ports.ts` had no general update operation at all.
     */
    it('is a no-op when the port has no updateSource', async () => {
      const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]) });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      await act(async () => {
        await result.current.update('a', { enabled: false });
      });
      expect(result.current.sources[0]).toEqual(SEED);
    });

    it('patches the source (e.g. enabled) on success', async () => {
      const updated: SourceConfigItem = { ...SEED, enabled: false };
      const updateSource = vi.fn().mockResolvedValue(updated);
      const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([{ ...SEED, enabled: true }]), updateSource });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toHaveLength(1));
      await act(async () => {
        await result.current.update('a', { enabled: false });
      });
      expect(updateSource).toHaveBeenCalledWith('a', { enabled: false });
      expect(result.current.sources[0]?.enabled).toBe(false);
    });

    it('leaves the source in place when the port returns null', async () => {
      const updateSource = vi.fn().mockResolvedValue(null);
      const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]), updateSource });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      await act(async () => {
        await result.current.update('a', { label: 'Renamed' });
      });
      expect(result.current.sources[0]).toEqual(SEED);
    });

    it('tracks pending state for exactly the id being updated, for the duration of the call', async () => {
      let resolveUpdate!: (source: SourceConfigItem | null) => void;
      const updateSource = vi.fn().mockReturnValue(new Promise((resolve) => (resolveUpdate = resolve)));
      const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]), updateSource });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      let updatePromise!: Promise<void>;
      act(() => {
        updatePromise = result.current.update('a', { enabled: false });
      });
      expect(result.current.isPending('a', 'update')).toBe(true);
      await act(async () => {
        resolveUpdate({ ...SEED, enabled: false });
        await updatePromise;
      });
      expect(result.current.isPending('a', 'update')).toBe(false);
    });
  });

  describe('test', () => {
    it('is a no-op when the port has no testSource', async () => {
      const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]) });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      await act(async () => {
        await result.current.test('a');
      });
      expect(result.current.testResults).toEqual({});
    });

    it('stores the result keyed by source id, and forwards an optional draft', async () => {
      const testSource = vi.fn().mockResolvedValue({ ok: true, message: 'reached', latencyMs: 12 });
      const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]), testSource });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      await act(async () => {
        await result.current.test('a', { url: 'https://draft.example' });
      });
      expect(testSource).toHaveBeenCalledWith('a', { url: 'https://draft.example' });
      expect(result.current.testResults.a).toEqual({ ok: true, message: 'reached', latencyMs: 12 });
    });

    /**
     * Regression for the audit finding that "test before save" (testing the
     * add-form's unsaved draft, which has no item id yet) was unrepresentable:
     * the port contract already accepted an optional `draft`, but every call
     * site assumed an already-persisted `id`. `id === undefined` is the real
     * "no persisted item yet" case (mirrors real OD's `testProviderInline`,
     * which calls its test endpoint with only the current form field values,
     * never an id) — result/pending state for it is tracked under the
     * `DRAFT_TEST_SCOPE` pseudo-id rather than a real source id.
     */
    it('tests an unsaved draft (no id) and stores the result under the draft scope, not mixed with any real source id', async () => {
      const testSource = vi.fn().mockResolvedValue({ ok: false, message: 'invalid key', latencyMs: 3 });
      const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]), testSource });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      await act(async () => {
        await result.current.test(undefined, { apiKey: 'sk-draft' });
      });
      expect(testSource).toHaveBeenCalledWith(undefined, { apiKey: 'sk-draft' });
      expect(result.current.testResults['__draft__']).toEqual({ ok: false, message: 'invalid key', latencyMs: 3 });
      expect(result.current.testResults.a).toBeUndefined();
    });

    it('tracks pending state for a draft test independently of any real source id', async () => {
      let resolveTest!: (result: { ok: boolean }) => void;
      const testSource = vi.fn().mockReturnValue(new Promise((resolve) => (resolveTest = resolve)));
      const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]), testSource });
      const { result } = renderHook(() => useSourceConfigList({ port }));
      await waitFor(() => expect(result.current.sources).toEqual([SEED]));
      let testPromise!: Promise<void>;
      act(() => {
        testPromise = result.current.test(undefined, { apiKey: 'sk-draft' });
      });
      expect(result.current.isPending('__draft__', 'test')).toBe(true);
      expect(result.current.isPending('a', 'test')).toBe(false);
      await act(async () => {
        resolveTest({ ok: true });
        await testPromise;
      });
      expect(result.current.isPending('__draft__', 'test')).toBe(false);
    });
  });
});

describe('useWiredSourceConfigList', () => {
  it('binds the port from dependencies', async () => {
    const port = fakePort({ fetchSources: vi.fn().mockResolvedValue([SEED]) });
    const { result } = renderHook(() => useWiredSourceConfigList({ dependencies: { port } }));
    await waitFor(() => expect(result.current.sources).toEqual([SEED]));
  });
});
