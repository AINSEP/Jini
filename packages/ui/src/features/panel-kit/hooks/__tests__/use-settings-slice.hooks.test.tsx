import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SAVE_DEBOUNCE_MS,
  canAcceptRefresh,
  commitQueuedSave,
  mergeSaveStates,
  useSettingsSlice,
  type SaveState,
  type SettingsRefreshScope,
  type SettingsSliceOptions,
  type SettingsSliceRefreshPort,
} from '../use-settings-slice.hooks.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A hand-written refresh bus: records publishes and lets the test emit notifications. */
function fakeRefreshPort() {
  const listeners = new Set<(scope: SettingsRefreshScope) => void>();
  const published: Array<readonly string[]> = [];
  const port: SettingsSliceRefreshPort = {
    publish: ({ namespaces }) => { published.push(namespaces); },
    subscribe: ({ listener }) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { port, published, emit: (scope: SettingsRefreshScope) => { for (const l of listeners) l(scope); }, listeners };
}

function mount(options: Partial<SettingsSliceOptions<string>> & Pick<SettingsSliceOptions<string>, 'refreshPort'>) {
  return renderHook(() => useSettingsSlice<string>({
    defaultValue: 'default', load: async () => 'loaded', save: async () => ['value'], ...options,
  }, {}));
}

describe('commitQueuedSave', () => {
  const run = (overrides: Partial<Parameters<typeof commitQueuedSave>[0]['deps']> = {}, ticket = 1) => {
    const states: SaveState[] = [];
    const deps = { runSave: async () => ['k'] as readonly string[], currentTicket: () => 1, hasUnsavedEdits: () => false,
      setSaveState: (s: SaveState) => { states.push(s); }, ...overrides };
    return commitQueuedSave({ ticket, deps }).then(() => states);
  };

  it('reports saved when fields were written and idle when nothing was', async () => {
    expect(await run()).toEqual([{ status: 'saved' }]);
    expect(await run({ runSave: async () => [] })).toEqual([{ status: 'idle' }]);
  });

  it('stays silent when a newer save superseded this one, on success and on failure', async () => {
    expect(await run({ currentTicket: () => 2 })).toEqual([]);
    expect(await run({ currentTicket: () => 2, runSave: async () => { throw new Error('late'); } })).toEqual([]);
  });

  it('does not claim saved while a newer edit is still unsaved', async () => {
    expect(await run({ hasUnsavedEdits: () => true })).toEqual([]);
  });

  it('reports the failure message, stringifying non-Error rejections', async () => {
    expect(await run({ runSave: async () => { throw new Error('disk full'); } })).toEqual([{ status: 'error', message: 'disk full' }]);
    expect(await run({ runSave: () => Promise.reject('offline') })).toEqual([{ status: 'error', message: 'offline' }]);
  });
});

describe('canAcceptRefresh', () => {
  const clear = { timerPending: false, hasUnsavedEdits: false, mounted: true, commitsUnchanged: true };
  it('accepts only when nothing is pending, the slice is mounted and no save committed meanwhile', () => {
    expect(canAcceptRefresh(clear)).toBe(true);
    expect(canAcceptRefresh({ ...clear, timerPending: true })).toBe(false);
    expect(canAcceptRefresh({ ...clear, hasUnsavedEdits: true })).toBe(false);
    expect(canAcceptRefresh({ ...clear, mounted: false })).toBe(false);
    expect(canAcceptRefresh({ ...clear, commitsUnchanged: false })).toBe(false);
  });
});

describe('mergeSaveStates', () => {
  it('ranks error over saving over saved over idle', () => {
    const error: SaveState = { status: 'error', message: 'x' };
    expect(mergeSaveStates({ states: [{ status: 'saved' }, error, { status: 'saving' }] })).toBe(error);
    expect(mergeSaveStates({ states: [{ status: 'saved' }, { status: 'saving' }] })).toEqual({ status: 'saving' });
    expect(mergeSaveStates({ states: [{ status: 'idle' }, { status: 'saved' }] })).toEqual({ status: 'saved' });
    expect(mergeSaveStates({ states: [{ status: 'idle' }] })).toEqual({ status: 'idle' });
    expect(mergeSaveStates({ states: [] })).toEqual({ status: 'idle' });
  });
});

describe('useSettingsSlice load', () => {
  it('reports a failed load and falls back to the default value', async () => {
    const { port } = fakeRefreshPort();
    const { result } = mount({ refreshPort: port, load: async () => { throw new Error('settings offline'); } });
    await act(async () => {});
    expect(result.current).toMatchObject({ value: 'default', loadError: 'settings offline' });
  });

  it('stringifies a non-Error load failure and keeps an edit made before it settled', async () => {
    const { port } = fakeRefreshPort();
    const load = deferred<string>();
    const { result } = mount({ refreshPort: port, load: () => load.promise });
    act(() => result.current.onChange('typed early'));
    await act(async () => { load.reject('unreachable'); });
    expect(result.current).toMatchObject({ value: 'typed early', loadError: 'unreachable' });
  });

  it('keeps an edit made before the initial load resolved', async () => {
    const { port } = fakeRefreshPort();
    const load = deferred<string>();
    const { result } = mount({ refreshPort: port, load: () => load.promise });
    act(() => result.current.onChange('typed early'));
    await act(async () => { load.resolve('server value'); });
    expect(result.current.value).toBe('typed early');
  });

  it('ignores a load that settles after unmount', async () => {
    const { port } = fakeRefreshPort();
    const ok = deferred<string>();
    const first = mount({ refreshPort: port, load: () => ok.promise });
    first.unmount();
    await act(async () => { ok.resolve('late'); });
    expect(first.result.current.value).toBeNull();
    const failing = deferred<string>();
    const second = mount({ refreshPort: port, load: () => failing.promise });
    second.unmount();
    await act(async () => { failing.reject(new Error('late failure')); });
    expect(second.result.current.loadError).toBeNull();
  });
});

describe('useSettingsSlice saving', () => {
  it('debounces rapid edits into one save, reports idle when nothing was written, and publishes declared namespaces', async () => {
    vi.useFakeTimers();
    const bus = fakeRefreshPort();
    const save = vi.fn(async () => [] as readonly string[]);
    const { result } = mount({ refreshPort: bus.port, save, namespaces: ['core.language'] });
    await act(async () => {});
    act(() => result.current.onChange('a'));
    act(() => result.current.onChange('ab'));
    await act(async () => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS); });
    expect(save.mock.calls).toEqual([[{ next: 'ab', previous: 'loaded' }, {}]]);
    expect(result.current.saveState).toEqual({ status: 'idle' });
    expect(bus.published).toEqual([['core.language']]);
  });

  it('publishes nothing for a slice that declared an empty namespace list', async () => {
    vi.useFakeTimers();
    const bus = fakeRefreshPort();
    const { result } = mount({ refreshPort: bus.port, namespaces: [] });
    await act(async () => {});
    act(() => result.current.onChange('x'));
    await act(async () => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS); });
    expect(result.current.saveState).toEqual({ status: 'saved' });
    expect(bus.published).toEqual([]);
  });

  it('skips the unmount flush when the pending edit returned to the value already being saved', async () => {
    vi.useFakeTimers();
    const bus = fakeRefreshPort();
    const first = deferred<void>();
    const writes: string[] = [];
    const { result, unmount } = mount({ refreshPort: bus.port, save: async ({ next }) => { writes.push(next); await first.promise; return ['v']; } });
    await act(async () => {});
    act(() => result.current.onChange('B'));
    await act(async () => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS); });
    act(() => result.current.onChange('C'));
    act(() => result.current.onChange('B'));
    await act(async () => { first.resolve(); });
    unmount();
    await act(async () => {});
    expect(writes).toEqual(['B']);
  });

  it('unmounts without saving when nothing was edited', async () => {
    const bus = fakeRefreshPort();
    const save = vi.fn(async () => ['v'] as readonly string[]);
    const { unmount } = mount({ refreshPort: bus.port, save });
    await act(async () => {});
    unmount();
    await act(async () => {});
    expect(save).not.toHaveBeenCalled();
  });
});

describe('useSettingsSlice refresh notifications', () => {
  it('reloads on a notification for its own namespace or an unscoped one, and ignores unrelated namespaces', async () => {
    const bus = fakeRefreshPort();
    let server = 'v1';
    const { result } = mount({ refreshPort: bus.port, namespaces: ['core.language'], load: async () => server });
    await act(async () => {});
    server = 'v2';
    await act(async () => { bus.emit(['billing']); });
    expect(result.current.value).toBe('v1');
    await act(async () => { bus.emit(['core.language']); });
    expect(result.current.value).toBe('v2');
    server = 'v3';
    await act(async () => { bus.emit(null); });
    expect(result.current.value).toBe('v3');
  });

  it('reloads on every notification when the slice declared no namespaces', async () => {
    const bus = fakeRefreshPort();
    let server = 'v1';
    const { result } = mount({ refreshPort: bus.port, load: async () => server });
    await act(async () => {});
    server = 'v2';
    await act(async () => { bus.emit(['anything']); });
    expect(result.current.value).toBe('v2');
  });

  it('applies the host reconciliation between the current and reloaded values', async () => {
    const bus = fakeRefreshPort();
    let server = 'v1';
    const { result } = mount({ refreshPort: bus.port, load: async () => server, reconcileRefresh: ({ current, loaded }) => `${current}+${loaded}` });
    await act(async () => {});
    server = 'v2';
    await act(async () => { await result.current.refresh(); });
    expect(result.current.value).toBe('v1+v2');
  });

  it('swallows a failed background reload and keeps the current value', async () => {
    const bus = fakeRefreshPort();
    let fail = false;
    const { result } = mount({ refreshPort: bus.port, load: async () => { if (fail) throw new Error('blip'); return 'v1'; } });
    await act(async () => {});
    fail = true;
    await act(async () => { await result.current.refresh(); });
    expect(result.current).toMatchObject({ value: 'v1', loadError: null });
  });

  it('refuses a reload while an edit is waiting for its debounce', async () => {
    vi.useFakeTimers();
    const bus = fakeRefreshPort();
    const load = vi.fn(async () => 'server');
    const { result } = mount({ refreshPort: bus.port, load });
    await act(async () => {});
    act(() => result.current.onChange('typing'));
    await act(async () => { await result.current.refresh(); });
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.value).toBe('typing');
  });

  it('drops a reload response superseded by a newer reload', async () => {
    const bus = fakeRefreshPort();
    const responses = [deferred<string>(), deferred<string>()];
    let call = 0;
    const { result } = mount({ refreshPort: bus.port, load: async () => (call++ === 0 ? 'initial' : responses[call - 2]!.promise) });
    await act(async () => {});
    let older!: Promise<void>, newer!: Promise<void>;
    act(() => { older = result.current.refresh(); newer = result.current.refresh(); });
    await act(async () => { responses[1]!.resolve('newest'); await newer; });
    await act(async () => { responses[0]!.resolve('stale'); await older; });
    expect(result.current.value).toBe('newest');
  });
});
