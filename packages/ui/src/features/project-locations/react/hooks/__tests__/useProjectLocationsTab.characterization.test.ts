import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeProjectLocationsPort } from '../../../dependencies.js';
import type { ProjectLocationsPort } from '../../../ports.js';
import type { ProjectLocation } from '../../../types.js';
import { scanAddedLocation, useProjectLocationsTab } from '../useProjectLocationsTab.js';

const builtIn: ProjectLocation = { id: 'default', name: 'Default', path: '/projects', builtIn: true };
const added: ProjectLocation = { id: 'added', name: 'Added', path: '/added' };
afterEach(() => vi.restoreAllMocks());

describe('useProjectLocationsTab add characterization', () => {
  it.each([null, ''])('reports cancellation for %j without saving or scanning', async (pick) => {
    const port = createFakeProjectLocationsPort({ locations: [builtIn], folderPicks: [pick] });
    const save = vi.spyOn(port, 'saveLocations');
    const scan = vi.spyOn(port, 'scanLocations');
    const { result } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.addFolder());
    await waitFor(() => expect(result.current.result).toEqual({ status: 'no-folder-selected' }));
    expect(result.current.drafts).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it.each(['/projects/', '/added\\'])('rejects duplicate built-in and external roots before save or scan: %s', async (pick) => {
    const port = createFakeProjectLocationsPort({ locations: [builtIn, added], folderPicks: [pick] });
    const save = vi.spyOn(port, 'saveLocations');
    const scan = vi.spyOn(port, 'scanLocations');
    const { result } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.addFolder());
    await waitFor(() => expect(result.current.result).toEqual({ status: 'duplicate' }));
    expect(result.current.drafts).toEqual([{ id: 'added', path: '/added' }]);
    expect(save).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it('keeps the saved result when the current port has no scan capability', async () => {
    const port: ProjectLocationsPort = {
      fetchLocations: async () => [builtIn],
      openFolderDialog: async () => '/added',
      saveLocations: vi.fn(async () => [builtIn, added]),
    };
    const { result } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.addFolder());
    await waitFor(() => expect(result.current.result).toEqual({ status: 'saved' }));
    expect(port.saveLocations).toHaveBeenCalledWith([{ path: '/added' }]);
    expect(result.current.locations).toEqual([builtIn, added]);
    expect(result.current.drafts).toEqual([{ id: 'added', path: '/added' }]);
    expect(result.current.saving).toBe(false);
  });

  it('saves before scanning and binds the scan receiver to the current port', async () => {
    const calls: string[] = [];
    const port: ProjectLocationsPort = {
      fetchLocations: async () => [builtIn],
      openFolderDialog: async () => '/added',
      saveLocations: vi.fn(async () => { calls.push('save'); return [builtIn, added]; }),
      async scanLocations() {
        expect(this).toBe(port);
        calls.push('scan');
        return { imported: ['a', 'b'], existing: ['c'] };
      },
    };
    const { result } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let returned: unknown;
    act(() => { returned = result.current.addFolder(); });
    expect(returned).toBeUndefined();
    await waitFor(() => expect(result.current.result).toEqual({ status: 'scan-complete', imported: 2, existing: 1 }));
    expect(calls).toEqual(['save', 'scan']);
    expect(port.saveLocations).toHaveBeenCalledWith([{ path: '/added' }]);
    expect(result.current.drafts).toEqual([{ id: 'added', path: '/added' }]);
  });

  it.each([new Error('disk full'), 'disk full'])('rolls back a failed save and never scans (%s)', async (error) => {
    const port = createFakeProjectLocationsPort({ locations: [builtIn], folderPicks: ['/added'] });
    vi.spyOn(port, 'saveLocations').mockRejectedValue(error);
    const scan = vi.spyOn(port, 'scanLocations');
    const { result } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.addFolder());
    await waitFor(() => expect(result.current.result).toEqual({ status: 'save-error', message: 'disk full' }));
    expect(result.current.drafts).toEqual([]);
    expect(result.current.locations).toEqual([builtIn]);
    expect(result.current.saving).toBe(false);
    expect(scan).not.toHaveBeenCalled();
  });

  it.each([new Error('scan failed'), 'scan failed'])('keeps the saved rows and reports scan rejection (%s)', async (error) => {
    const port: ProjectLocationsPort = {
      fetchLocations: async () => [builtIn],
      openFolderDialog: async () => '/added',
      saveLocations: async () => [builtIn, added],
      scanLocations: () => Promise.reject(error),
    };
    const { result } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.addFolder());
    await waitFor(() => expect(result.current.result).toEqual({ status: 'scan-error', message: 'scan failed' }));
    expect(result.current.locations).toEqual([builtIn, added]);
    expect(result.current.drafts).toEqual([{ id: 'added', path: '/added' }]);
    expect(result.current.saving).toBe(false);
  });

  it('reports a synchronous scan throw as a scan error after keeping the successful save', async () => {
    const port: ProjectLocationsPort = {
      fetchLocations: async () => [builtIn],
      openFolderDialog: async () => '/added',
      saveLocations: async () => [builtIn, added],
      scanLocations() { throw new Error('sync scan failure'); },
    };
    const { result } = renderHook(() => useProjectLocationsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.addFolder());
    await waitFor(() => expect(result.current.result).toEqual({ status: 'scan-error', message: 'sync scan failure' }));
    expect(result.current.locations).toEqual([builtIn, added]);
  });

  it.each([
    { outcome: 'resolve', mounted: false }, { outcome: 'reject', mounted: false },
    { outcome: 'resolve', mounted: true }, { outcome: 'reject', mounted: true },
  ])('scan $outcome publishes only while mounted ($mounted)', async ({ outcome, mounted }) => {
    type ScanResult = { imported: readonly string[]; existing: readonly string[] };
    let resolve!: (value: ScanResult) => void;
    let reject!: (reason: unknown) => void;
    const pending = new Promise<ScanResult>((yes, no) => { resolve = yes; reject = no; });
    const scan = vi.fn<NonNullable<ProjectLocationsPort['scanLocations']>>(() => pending);
    const port = { ...createFakeProjectLocationsPort({ locations: [builtIn] }), scanLocations: scan };
    const setResult = vi.fn();
    const alive = { current: true };
    const completion = scanAddedLocation({ port, alive, setResult });
    expect(scan).toHaveBeenCalledTimes(1);
    expect(setResult).not.toHaveBeenCalled();
    alive.current = mounted;
    if (outcome === 'resolve') resolve({ imported: ['late'], existing: [] });
    else reject(new Error('late failure'));
    await completion;
    if (!mounted) expect(setResult).not.toHaveBeenCalled();
    else {
      expect(setResult).toHaveBeenCalledTimes(1);
      expect(setResult).toHaveBeenCalledWith(outcome === 'resolve'
        ? { status: 'scan-complete', imported: 1, existing: 0 }
        : { status: 'scan-error', message: 'late failure' });
    }
  });

  it('uses the latest port to scan after an outstanding save completes', async () => {
    let resolve!: (value: readonly ProjectLocation[]) => void;
    const pending = new Promise<readonly ProjectLocation[]>((yes) => { resolve = yes; });
    const original: ProjectLocationsPort = {
      fetchLocations: async () => [builtIn],
      openFolderDialog: async () => '/added',
      saveLocations: vi.fn(() => pending),
      scanLocations: vi.fn(async () => ({ imported: [], existing: [] })),
    };
    const replacement: ProjectLocationsPort = {
      ...original,
      async scanLocations() {
        expect(this).toBe(replacement);
        return { imported: ['new-port'], existing: ['a', 'b'] };
      },
    };
    const { result, rerender } = renderHook(({ port }) => useProjectLocationsTab({ port }), { initialProps: { port: original } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.addFolder());
    await waitFor(() => expect(original.saveLocations).toHaveBeenCalledOnce());
    rerender({ port: replacement });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { resolve([builtIn, added]); await pending; });
    await waitFor(() => expect(result.current.result).toEqual({ status: 'scan-complete', imported: 1, existing: 2 }));
    expect(original.scanLocations).not.toHaveBeenCalled();
    expect(result.current.locations).toEqual([builtIn, added]);
  });
});
