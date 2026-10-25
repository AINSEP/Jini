import { StrictMode, type ReactNode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IDLE_RETENTION, type FetchQueryCacheOptions, type QueryCacheSchedulerPort } from '@jini-ai/core/fetch';
import { FetchQueryProvider, useCachedLoader, useFetchQuery } from '../index.js';

/** Records host timers without touching global time; tests explicitly run pending callbacks. */
function recordingScheduler() {
  const pending = new Map<unknown, { callback: () => void; delayMs: number }>();
  let nextHandle = 0;
  const port: QueryCacheSchedulerPort = {
    schedule: ({ callback, delayMs }) => {
      const handle = ++nextHandle;
      pending.set(handle, { callback, delayMs });
      return handle;
    },
    cancel: vi.fn(({ handle }) => { pending.delete(handle); }),
  };
  return { port, pending };
}

describe('built-in provider timing ports', () => {
  it('shares clock-controlled loader freshness with reactive reads, including exact expiry', async () => {
    let now = 100;
    const clock = { nowMs: () => now };
    const { port: scheduler } = recordingScheduler();
    const key = ['rows'] as const;
    const fetch = vi.fn<() => Promise<string>>().mockResolvedValueOnce('first').mockResolvedValue('next');
    const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider clock={clock} scheduler={scheduler}>{children}</FetchQueryProvider>;
    const { result } = renderHook(() => ({
      loader: useCachedLoader({ key, fetch }, { staleTime: 50 }),
      read: useFetchQuery({ key, fetch }, { staleTime: 50, enabled: false }),
    }), { wrapper });

    await act(async () => { expect(await result.current.loader.load()).toBe('first'); });
    expect(result.current.read.data).toBe('first');
    now = 149;
    await act(async () => { expect(await result.current.loader.load()).toBe('first'); });
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 150;
    await act(async () => { expect(await result.current.loader.load()).toBe('next'); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.read.data).toBe('next');
  });

  it.each([50, IDLE_RETENTION + 100])('uses the host scheduler for retention, resubscription and disposal (staleTime %s)', async staleTime => {
    const clock = { nowMs: () => 100 };
    const { port: scheduler, pending } = recordingScheduler();
    const key = ['retained'] as const;
    const fetch = vi.fn<() => Promise<string>>().mockResolvedValueOnce('cached').mockResolvedValue('reloaded');
    let loader!: ReturnType<typeof useCachedLoader<string>>;
    function Loader() {
      loader = useCachedLoader({ key, fetch }, { staleTime });
      return null;
    }
    function Reader() {
      const query = useFetchQuery({ key, fetch }, { staleTime });
      return <span data-testid="retained">{query.data}</span>;
    }
    const scope = (observed: boolean) => <FetchQueryProvider clock={clock} scheduler={scheduler}>
      <Loader />{observed && <Reader />}
    </FetchQueryProvider>;
    const view = render(scope(false));
    await act(async () => { expect(await loader.load()).toBe('cached'); });
    expect(pending.size).toBe(1);
    const [handle, timer] = [...pending.entries()][0]!;
    expect(timer.delayMs).toBe(Math.max(IDLE_RETENTION, staleTime));

    view.rerender(scope(true));
    await act(async () => {});
    expect(screen.getByTestId('retained').textContent).toBe('cached');
    expect(scheduler.cancel).toHaveBeenCalledWith({ handle });
    expect(pending.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    view.rerender(scope(false));
    expect(pending.size).toBe(1);
    const [idleHandle, idleTimer] = [...pending.entries()][0]!;
    expect(idleTimer.delayMs).toBe(Math.max(IDLE_RETENTION, staleTime));
    pending.delete(idleHandle);
    act(() => idleTimer.callback());
    expect(loader.peek()).toBeUndefined();
    await act(async () => { expect(await loader.load()).toBe('reloaded'); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(pending.size).toBe(1);
    const [lastHandle] = [...pending.keys()];
    view.unmount();
    expect(scheduler.cancel).toHaveBeenCalledWith({ handle: lastHandle });
    expect(pending.size).toBe(0);
  });

  it('isolates providers sharing timing ports and remains usable through StrictMode effect replay', async () => {
    const clock = { nowMs: () => 100 };
    const { port: scheduler, pending } = recordingScheduler();
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>
      <FetchQueryProvider clock={clock} scheduler={scheduler}>{children}</FetchQueryProvider>
    </StrictMode>;
    const key = ['same'] as const;
    const firstFetch = vi.fn(async () => 'first');
    const secondFetch = vi.fn(async () => 'second');
    const first = renderHook(() => useCachedLoader({ key, fetch: firstFetch }), { wrapper });
    const second = renderHook(() => useCachedLoader({ key, fetch: secondFetch }), { wrapper });
    await act(async () => {
      expect(await first.result.current.load()).toBe('first');
      expect(await second.result.current.load()).toBe('second');
    });
    expect(first.result.current.peek()).toBe('first');
    expect(second.result.current.peek()).toBe('second');
    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(secondFetch).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(2);
    first.unmount();
    expect(pending.size).toBe(1);
    expect(second.result.current.peek()).toBe('second');
    second.unmount();
    expect(pending.size).toBe(0);
  });

  it.each(['clock', 'scheduler'] as const)('preserves stable ports and disposes the previous cache when %s changes', async changedPort => {
    const original = recordingScheduler();
    const replacement = recordingScheduler();
    const ports: Pick<FetchQueryCacheOptions, 'clock' | 'scheduler'> = {
      clock: { nowMs: () => 100 }, scheduler: original.port,
    };
    const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider {...ports}>{children}</FetchQueryProvider>;
    const key = ['identity'] as const;
    const fetch = vi.fn<() => Promise<string>>().mockResolvedValueOnce('old scope').mockResolvedValue('new scope');
    const hook = renderHook(() => useCachedLoader({ key, fetch }), { wrapper });
    await act(async () => { expect(await hook.result.current.load()).toBe('old scope'); });
    expect(original.pending.size).toBe(1);
    const [handle] = [...original.pending.keys()];

    hook.rerender();
    expect(hook.result.current.peek()).toBe('old scope');
    expect([...original.pending.keys()]).toEqual([handle]);
    expect(original.port.cancel).not.toHaveBeenCalled();
    if (changedPort === 'clock') ports.clock = { nowMs: () => 200 };
    else ports.scheduler = replacement.port;
    hook.rerender();
    expect(hook.result.current.peek()).toBeUndefined();
    expect(original.port.cancel).toHaveBeenCalledWith({ handle });
    expect(original.pending.size).toBe(0);
    await act(async () => { expect(await hook.result.current.load()).toBe('new scope'); });
    expect(fetch).toHaveBeenCalledTimes(2);
    const active = changedPort === 'clock' ? original : replacement;
    expect(active.pending.size).toBe(1);
    hook.unmount();
    expect(original.pending.size).toBe(0);
    expect(replacement.pending.size).toBe(0);
  });
});
