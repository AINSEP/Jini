// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAssetGridLiveUpdates, useWiredAssetGridLiveUpdates } from '../../../react/hooks/useAssetGridLiveUpdates.js';
import type { AssetGridDependencies, AssetGridLiveUpdateHandlers, AssetGridLiveUpdatesPort } from '../../../ports.js';

interface TestAsset {
  id: string;
  kind: string;
}

function fakeLiveUpdatesPort(): { port: AssetGridLiveUpdatesPort; fire: () => AssetGridLiveUpdateHandlers; unsubscribe: () => boolean } {
  let handlers: AssetGridLiveUpdateHandlers | null = null;
  let unsubscribed = false;
  const port: AssetGridLiveUpdatesPort = {
    subscribe(h) {
      handlers = h;
      unsubscribed = false;
      return () => {
        unsubscribed = true;
      };
    },
  };
  return {
    port,
    fire: () => {
      if (!handlers) throw new Error('not subscribed');
      return handlers;
    },
    unsubscribe: () => unsubscribed,
  };
}

describe('useAssetGridLiveUpdates', () => {
  it('does nothing when inactive or no liveUpdates port is supplied', () => {
    const setAssets = vi.fn();
    const reload = vi.fn();
    renderHook(() =>
      useAssetGridLiveUpdates<TestAsset>({
        active: false,
        liveUpdates: undefined,
        filtersActive: false,
        setAssets,
        reload,
      }),
    );
    expect(setAssets).not.toHaveBeenCalled();
  });

  it('applies a delete event locally without fetching', async () => {
    vi.useFakeTimers();
    const { port, fire } = fakeLiveUpdatesPort();
    const setAssets = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useAssetGridLiveUpdates<TestAsset>({
        active: true,
        liveUpdates: port,
        filtersActive: false,
        setAssets,
        reload,
        coalesceMs: 50,
      }),
    );
    act(() => fire().onDelete('a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(reload).not.toHaveBeenCalled();
    expect(setAssets).toHaveBeenCalledTimes(1);
    const updater = setAssets.mock.calls[0]![0] as (prev: TestAsset[]) => TestAsset[];
    expect(updater([{ id: 'a', kind: 'image' }, { id: 'b', kind: 'image' }])).toEqual([{ id: 'b', kind: 'image' }]);
    vi.useRealTimers();
  });

  it('resolves an ingest event via fetchAssetById and merges it', async () => {
    vi.useFakeTimers();
    const { port, fire } = fakeLiveUpdatesPort();
    const setAssets = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    const fetchAssetById = vi.fn().mockResolvedValue({ id: 'new', kind: 'image' });
    renderHook(() =>
      useAssetGridLiveUpdates<TestAsset>({
        active: true,
        liveUpdates: port,
        filtersActive: false,
        fetchAssetById,
        setAssets,
        reload,
        coalesceMs: 50,
      }),
    );
    act(() => fire().onIngest('new'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(fetchAssetById).toHaveBeenCalledWith('new');
    expect(reload).not.toHaveBeenCalled();
    expect(setAssets).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  /**
   * The resurrection race. `flush` used to null `timer` on entry and then await, so a second pass
   * could start while the first was still inside `fetchById`. By then the first had drained
   * `pendingIngest`, so the second pass's delete found nothing there to cancel: it filtered the
   * asset out of the list, and the first pass then merged it straight back in. `fetched === null`
   * does not catch this — the fetch legitimately resolved WITH the asset, moments before it was
   * deleted.
   *
   * Passes are serialized now, so the delete lands AFTER the merge instead of before it, and the
   * final list is correct. Asserted on the resulting state rather than on call counts, because the
   * defect was never about how many times `setAssets` ran — it was about the order they composed in.
   */
  it('does not resurrect an asset deleted while its ingest fetch was still in flight', async () => {
    vi.useFakeTimers();
    const { port, fire } = fakeLiveUpdatesPort();
    let assets: TestAsset[] = [{ id: 'a', kind: 'image' }, { id: 'b', kind: 'image' }];
    const setAssets = vi.fn((updater: unknown) => {
      assets = (updater as (prev: TestAsset[]) => TestAsset[])(assets);
    });
    const reload = vi.fn().mockResolvedValue(undefined);
    let resolveFetch!: (value: TestAsset) => void;
    const fetchAssetById = vi.fn(
      () => new Promise<TestAsset>((resolve) => { resolveFetch = resolve; }),
    );
    renderHook(() =>
      useAssetGridLiveUpdates<TestAsset>({
        active: true,
        liveUpdates: port,
        filtersActive: false,
        fetchAssetById,
        setAssets: setAssets as unknown as React.Dispatch<React.SetStateAction<TestAsset[]>>,
        reload,
        coalesceMs: 50,
      }),
    );

    // Pass 1 takes the ingest and parks on the fetch.
    act(() => fire().onIngest('a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(fetchAssetById).toHaveBeenCalledWith('a');

    // The asset is deleted while that fetch is still outstanding.
    act(() => fire().onDelete('a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Now the fetch answers — with the asset, because it was still there when the read happened.
    await act(async () => {
      resolveFetch({ id: 'a', kind: 'image' });
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(assets.map((asset) => asset.id)).toEqual(['b']);
    expect(reload).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('falls back to a full reload when filtersActive is true, even for an ingest event', async () => {
    vi.useFakeTimers();
    const { port, fire } = fakeLiveUpdatesPort();
    const setAssets = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    const fetchAssetById = vi.fn().mockResolvedValue({ id: 'new', kind: 'image' });
    renderHook(() =>
      useAssetGridLiveUpdates<TestAsset>({
        active: true,
        liveUpdates: port,
        filtersActive: true,
        fetchAssetById,
        setAssets,
        reload,
        coalesceMs: 50,
      }),
    );
    act(() => fire().onIngest('new'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(fetchAssetById).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('falls back to a full reload for onFullReload', async () => {
    vi.useFakeTimers();
    const { port, fire } = fakeLiveUpdatesPort();
    const setAssets = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useAssetGridLiveUpdates<TestAsset>({
        active: true,
        liveUpdates: port,
        filtersActive: false,
        setAssets,
        reload,
        coalesceMs: 50,
      }),
    );
    act(() => fire().onFullReload());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('falls back to a full reload when no fetchAssetById is supplied for an ingest event', async () => {
    vi.useFakeTimers();
    const { port, fire } = fakeLiveUpdatesPort();
    const setAssets = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useAssetGridLiveUpdates<TestAsset>({
        active: true,
        liveUpdates: port,
        filtersActive: false,
        setAssets,
        reload,
        coalesceMs: 50,
      }),
    );
    act(() => fire().onIngest('new'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('falls back to a full reload when a resolved ingest id fetches null (ambiguous race)', async () => {
    vi.useFakeTimers();
    const { port, fire } = fakeLiveUpdatesPort();
    const setAssets = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    const fetchAssetById = vi.fn().mockResolvedValue(null);
    renderHook(() =>
      useAssetGridLiveUpdates<TestAsset>({
        active: true,
        liveUpdates: port,
        filtersActive: false,
        fetchAssetById,
        setAssets,
        reload,
        coalesceMs: 50,
      }),
    );
    act(() => fire().onIngest('gone'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('coalesces a burst of events within the window into one flush', async () => {
    vi.useFakeTimers();
    const { port, fire } = fakeLiveUpdatesPort();
    const setAssets = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    const fetchAssetById = vi.fn().mockResolvedValue({ id: 'a', kind: 'image' });
    renderHook(() =>
      useAssetGridLiveUpdates<TestAsset>({
        active: true,
        liveUpdates: port,
        filtersActive: false,
        fetchAssetById,
        setAssets,
        reload,
        coalesceMs: 50,
      }),
    );
    act(() => {
      fire().onIngest('a');
      fire().onIngest('b');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(fetchAssetById).toHaveBeenCalledTimes(2);
    expect(setAssets).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('unsubscribes on unmount', () => {
    const { port, unsubscribe } = fakeLiveUpdatesPort();
    const { unmount } = renderHook(() =>
      useAssetGridLiveUpdates<TestAsset>({
        active: true,
        liveUpdates: port,
        filtersActive: false,
        setAssets: vi.fn(),
        reload: vi.fn().mockResolvedValue(undefined),
      }),
    );
    expect(unsubscribe()).toBe(false);
    unmount();
    expect(unsubscribe()).toBe(true);
  });

  it('clears a pending coalesce timer on unmount instead of letting it fire after teardown', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { port, fire } = fakeLiveUpdatesPort();
    const setAssets = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useAssetGridLiveUpdates<TestAsset>({
        active: true,
        liveUpdates: port,
        filtersActive: false,
        setAssets,
        reload,
        coalesceMs: 50,
      }),
    );
    // Fire an event so a coalesce timer is scheduled but hasn't flushed yet.
    act(() => fire().onDelete('a'));
    const callsBeforeUnmount = clearTimeoutSpy.mock.calls.length;
    unmount();
    expect(clearTimeoutSpy.mock.calls.length).toBe(callsBeforeUnmount + 1);
    // Advancing time after unmount must not flush the (cleared) timer.
    vi.advanceTimersByTime(1000);
    expect(setAssets).not.toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe('useWiredAssetGridLiveUpdates', () => {
  it('binds `liveUpdates`/`fetchAssetById` from the supplied `dependencies` (not a hardcoded fake)', async () => {
    vi.useFakeTimers();
    const { port, fire } = fakeLiveUpdatesPort();
    const fetchAssetById = vi.fn().mockResolvedValue({ id: 'new', kind: 'image' });
    const dependencies: AssetGridDependencies<TestAsset> = {
      data: { fetchAssets: vi.fn().mockResolvedValue([]), fetchAssetById },
      liveUpdates: port,
    };
    const setAssets = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useWiredAssetGridLiveUpdates<TestAsset>({
        dependencies,
        active: true,
        filtersActive: false,
        setAssets,
        reload,
        coalesceMs: 50,
      }),
    );
    act(() => fire().onIngest('new'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(fetchAssetById).toHaveBeenCalledWith('new');
    expect(setAssets).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('falls back to the package in-memory fake (no liveUpdates, no-op) when `dependencies` is omitted', () => {
    const setAssets = vi.fn();
    const reload = vi.fn();
    renderHook(() =>
      useWiredAssetGridLiveUpdates<TestAsset>({
        active: true,
        filtersActive: false,
        setAssets,
        reload,
      }),
    );
    expect(setAssets).not.toHaveBeenCalled();
  });
});
