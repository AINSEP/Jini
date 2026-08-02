import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProjectLocationsPort } from '../../../ports.js';
import type { ProjectLocation } from '../../../types.js';
import { useProjectLocationsTab } from '../../../react/hooks/useProjectLocationsTab.js';

const BUILT_IN: ProjectLocation = { id: 'default', name: 'Default', path: '/home/op/projects', builtIn: true };

/** A promise plus its resolve/reject, for tests that need to control exactly
 *  when a port call settles relative to an unmount. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useProjectLocationsTab — initial load', () => {
  it('does not act on the fetchLocations resolution once unmounted before it settles', async () => {
    const fetch = deferred<readonly ProjectLocation[]>();
    const port: ProjectLocationsPort = {
      fetchLocations: () => fetch.promise,
      openFolderDialog: () => Promise.resolve(null),
      saveLocations: () => Promise.reject(new Error('n/a')),
    };
    const { result, unmount } = renderHook(() => useProjectLocationsTab({ port }));
    const beforeUnmount = result.current;

    unmount();
    fetch.resolve([BUILT_IN]);
    await fetch.promise;

    expect(result.current).toBe(beforeUnmount);
  });
});

describe('useProjectLocationsTab — save (via addFolder)', () => {
  it('does not finish the save once unmounted before saveLocations resolves', async () => {
    const save = deferred<readonly ProjectLocation[]>();
    const port: ProjectLocationsPort = {
      fetchLocations: () => Promise.resolve([BUILT_IN]),
      openFolderDialog: () => Promise.resolve('/home/op/new-project'),
      saveLocations: () => save.promise,
    };
    const { result, unmount } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.addFolder();
    await waitFor(() => expect(result.current.saving).toBe(true));
    const beforeUnmount = result.current;

    unmount();
    save.resolve([BUILT_IN, { id: 'loc-1', name: 'new-project', path: '/home/op/new-project' }]);
    await save.promise;

    expect(result.current).toBe(beforeUnmount);
  });

  it('does not finish the save once unmounted before a rejecting saveLocations settles', async () => {
    const save = deferred<readonly ProjectLocation[]>();
    const port: ProjectLocationsPort = {
      fetchLocations: () => Promise.resolve([BUILT_IN]),
      openFolderDialog: () => Promise.resolve('/home/op/new-project'),
      saveLocations: () => save.promise,
    };
    const { result, unmount } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.addFolder();
    await waitFor(() => expect(result.current.saving).toBe(true));
    const beforeUnmount = result.current;

    unmount();
    save.reject(new Error('disk full'));
    await save.promise.catch(() => undefined);

    expect(result.current).toBe(beforeUnmount);
  });

  it('reports a save-error message with a non-Error rejection', async () => {
    const port: ProjectLocationsPort = {
      fetchLocations: () => Promise.resolve([BUILT_IN]),
      openFolderDialog: () => Promise.resolve('/home/op/new-project'),
      // A lazy implementation, not an eagerly-created rejected promise —
      // the latter fires before persist's `.catch` is attached and trips
      // Node's unhandled-rejection detector.
      saveLocations: () => Promise.reject('disk full'),
    };
    const { result } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.addFolder();
    await waitFor(() => expect(result.current.result).toEqual({ status: 'save-error', message: 'disk full' }));
  });
});

describe('useProjectLocationsTab — addFolder', () => {
  it('does not proceed once unmounted before the folder dialog resolves', async () => {
    const pick = deferred<string | null>();
    const port: ProjectLocationsPort = {
      fetchLocations: () => Promise.resolve([BUILT_IN]),
      openFolderDialog: () => pick.promise,
      saveLocations: () => Promise.reject(new Error('n/a')),
    };
    const { result, unmount } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.addFolder();
    const beforeUnmount = result.current;

    unmount();
    pick.resolve('/home/op/new-project');
    await pick.promise;

    expect(result.current).toBe(beforeUnmount);
  });

  it('rolls back the optimistic draft when the save fails', async () => {
    const port: ProjectLocationsPort = {
      fetchLocations: () => Promise.resolve([BUILT_IN]),
      openFolderDialog: () => Promise.resolve('/home/op/new-project'),
      saveLocations: () => Promise.reject(new Error('disk full')),
    };
    const { result } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.addFolder();
    // The optimistic draft is rolled back once the save rejects.
    await waitFor(() => expect(result.current.result).toEqual({ status: 'save-error', message: 'disk full' }));
    expect(result.current.drafts).toHaveLength(0);
  });

  it('does not report a scan result once unmounted before scanLocations resolves', async () => {
    const scan = deferred<{ imported: readonly string[]; existing: readonly string[] }>();
    const port: ProjectLocationsPort = {
      fetchLocations: () => Promise.resolve([BUILT_IN]),
      openFolderDialog: () => Promise.resolve('/home/op/new-project'),
      saveLocations: (drafts) =>
        Promise.resolve([BUILT_IN, ...drafts.map((d, i) => ({ id: `new-${i}`, name: 'new-project', path: d.path }))]),
      scanLocations: () => scan.promise,
    };
    const { result, unmount } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.addFolder();
    // The save completes (status flips to 'saved') before the scan settles.
    await waitFor(() => expect(result.current.result).toEqual({ status: 'saved' }));
    const beforeUnmount = result.current;

    unmount();
    scan.resolve({ imported: [], existing: [] });
    await scan.promise;

    expect(result.current).toBe(beforeUnmount);
  });

  it('reports a scan-error when scanLocations rejects', async () => {
    const port: ProjectLocationsPort = {
      fetchLocations: () => Promise.resolve([BUILT_IN]),
      openFolderDialog: () => Promise.resolve('/home/op/new-project'),
      saveLocations: (drafts) =>
        Promise.resolve([BUILT_IN, ...drafts.map((d, i) => ({ id: `new-${i}`, name: 'new-project', path: d.path }))]),
      scanLocations: () => Promise.reject(new Error('scan crashed')),
    };
    const { result } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.addFolder();
    await waitFor(() => expect(result.current.result).toEqual({ status: 'scan-error', message: 'scan crashed' }));
  });

  it('reports a scan-error message with a non-Error scanLocations rejection', async () => {
    const port: ProjectLocationsPort = {
      fetchLocations: () => Promise.resolve([BUILT_IN]),
      openFolderDialog: () => Promise.resolve('/home/op/new-project'),
      saveLocations: (drafts) =>
        Promise.resolve([BUILT_IN, ...drafts.map((d, i) => ({ id: `new-${i}`, name: 'new-project', path: d.path }))]),
      // A lazy implementation, not an eagerly-created rejected promise — the
      // latter fires before the scan `.catch` is attached and trips Node's
      // unhandled-rejection detector.
      scanLocations: () => Promise.reject('scan service unreachable'),
    };
    const { result } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.addFolder();
    await waitFor(() =>
      expect(result.current.result).toEqual({ status: 'scan-error', message: 'scan service unreachable' }),
    );
  });

  it('does not report a scan-error once unmounted before a rejecting scanLocations settles', async () => {
    const scan = deferred<{ imported: readonly string[]; existing: readonly string[] }>();
    const port: ProjectLocationsPort = {
      fetchLocations: () => Promise.resolve([BUILT_IN]),
      openFolderDialog: () => Promise.resolve('/home/op/new-project'),
      saveLocations: (drafts) =>
        Promise.resolve([BUILT_IN, ...drafts.map((d, i) => ({ id: `new-${i}`, name: 'new-project', path: d.path }))]),
      scanLocations: () => scan.promise,
    };
    const { result, unmount } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.addFolder();
    // The save completes (status flips to 'saved') before the scan settles.
    await waitFor(() => expect(result.current.result).toEqual({ status: 'saved' }));
    const beforeUnmount = result.current;

    unmount();
    scan.reject(new Error('scan crashed'));
    await scan.promise.catch(() => undefined);

    expect(result.current).toBe(beforeUnmount);
  });
});
