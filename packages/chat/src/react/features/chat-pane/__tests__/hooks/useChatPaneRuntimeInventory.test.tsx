import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatPaneAgent, ChatPaneRuntimeAccess } from '../../types.js';
import { useChatPaneRuntimeInventory } from '../../hooks/useChatPaneRuntimeInventory.hooks.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const RETRY_20_40 = [20, 40];

function sleep(ms: number): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

function runtimeAccess(
  overrides: Partial<ChatPaneRuntimeAccess> = {},
): ChatPaneRuntimeAccess {
  return {
    listAgents: vi.fn(async () => []),
    rescanAgents: vi.fn(async () => []),
    daemonOnline: vi.fn(async () => true),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState;
});

/** Overrides jsdom's `document.visibilityState` (an own property shadowing the prototype getter,
 *  removed again in `afterEach`); `dispatch` also fires `visibilitychange`. */
function setVisibility(state: DocumentVisibilityState, dispatch = true): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  if (dispatch) document.dispatchEvent(new Event('visibilitychange'));
}

describe('useChatPaneRuntimeInventory', () => {
  it('loads inventory, polls health, and exposes explicit rescan state', async () => {
    vi.useFakeTimers();
    const initial: ChatPaneAgent[] = [{ id: 'codex', name: 'Codex' }];
    const rescanned: ChatPaneAgent[] = [{ id: 'claude', name: 'Claude' }];
    const access = runtimeAccess({
      listAgents: vi.fn(async () => initial),
      rescanAgents: vi.fn(async () => rescanned),
    });
    const { result } = renderHook(() => useChatPaneRuntimeInventory({
      access,
      pollIntervalMs: 100,
    }));

    await act(async () => {});
    expect(result.current.agents).toEqual(initial);
    expect(result.current.daemonOnline).toBe(true);

    await act(() => result.current.rescanAgents());
    expect(result.current.agents).toEqual(rescanned);
    expect(result.current.scanningAgents).toBe(false);

    await act(async () => vi.advanceTimersByTime(100));
    expect(access.daemonOnline).toHaveBeenCalledTimes(2);
  });

  it('remains live after StrictMode replays the mount effect', async () => {
    const access = runtimeAccess({
      listAgents: vi.fn(async () => [{ id: 'codex', name: 'Codex' }]),
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    const { result } = renderHook(
      () => useChatPaneRuntimeInventory({ access }),
      { wrapper },
    );

    await act(async () => {});
    expect(result.current.agents[0]?.id).toBe('codex');
  });

  it('ignores a stale capability response after switching to injected agents', async () => {
    const first = deferred<readonly ChatPaneAgent[]>();
    const access = runtimeAccess({ listAgents: vi.fn(() => first.promise) });
    const staticAgents: ChatPaneAgent[] = [{ id: 'gemini', name: 'Gemini' }];
    const { result, rerender } = renderHook(
      ({ currentAccess }: { currentAccess: ChatPaneRuntimeAccess | undefined }) =>
        useChatPaneRuntimeInventory({
          ...(currentAccess === undefined ? {} : { access: currentAccess }),
          initialAgents: staticAgents,
        }),
      { initialProps: { currentAccess: access as ChatPaneRuntimeAccess | undefined } },
    );

    rerender({ currentAccess: undefined });
    await act(async () => first.resolve([{ id: 'stale', name: 'Stale' }]));
    expect(result.current.agents).toEqual(staticAgents);
  });

  it('preserves prior inventory on rescan failure and ignores work after unmount', async () => {
    const pending = deferred<readonly ChatPaneAgent[]>();
    const access = runtimeAccess({
      listAgents: vi.fn(async () => [{ id: 'codex', name: 'Codex' }]),
      rescanAgents: vi
        .fn()
        .mockRejectedValueOnce('scan failed')
        .mockImplementationOnce(() => pending.promise),
    });
    const { result, unmount } = renderHook(() => useChatPaneRuntimeInventory({ access }));
    await act(async () => {});

    await act(() => result.current.rescanAgents());
    expect(result.current.agents[0]?.id).toBe('codex');
    expect(result.current.runtimeInventoryError?.message).toBe('scan failed');

    let late!: Promise<void>;
    act(() => {
      late = result.current.rescanAgents();
    });
    unmount();
    await act(async () => pending.resolve([{ id: 'late', name: 'Late' }]));
    await late;
  });

  it('fails closed when initial inventory and daemon health requests reject', async () => {
    const access = runtimeAccess({
      listAgents: vi.fn(async () => {
        throw new Error('inventory unavailable');
      }),
      daemonOnline: vi.fn(async () => {
        throw new Error('daemon unavailable');
      }),
    });
    const { result } = renderHook(() => useChatPaneRuntimeInventory({
      access,
      initialAgents: [{ id: 'stale', name: 'Stale' }],
    }));
    await act(async () => {});
    expect(result.current.agents).toEqual([]);
    expect(result.current.daemonOnline).toBe(false);
    expect(result.current.runtimeInventoryError?.message).toBe('inventory unavailable');
    expect(result.current.connectingAgents).toBe(true);
  });

  // 2026-09-28: a failed first load used to be final for the life of the pane — the daemon
  // restarting under an open chat left it on "No usable CLI is selected" until a hard reload.
  // Real timers with millisecond delays: React 19's async `act` stalls under vitest fake timers.
  it('retries a failed initial load with backoff and reports connecting until an answer arrives', async () => {
    const listAgents = vi
      .fn<ChatPaneRuntimeAccess['listAgents']>()
      .mockRejectedValueOnce(new Error('GET /api/agents answered 500'))
      .mockRejectedValueOnce(new Error('GET /api/agents answered 502'))
      .mockResolvedValueOnce([{ id: 'claude', name: 'Claude' }]);
    const access = runtimeAccess({ listAgents });
    const { result } = renderHook(() => useChatPaneRuntimeInventory({
      access,
      pollIntervalMs: 60_000,
      retryDelaysMs: RETRY_20_40,
    }));

    await act(async () => {});
    expect(listAgents).toHaveBeenCalledTimes(1);
    expect(result.current.connectingAgents).toBe(true);
    expect(result.current.agents).toEqual([]);

    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(2));
    expect(result.current.connectingAgents).toBe(true);

    await waitFor(() => expect(result.current.agents).toEqual([{ id: 'claude', name: 'Claude' }]));
    expect(listAgents).toHaveBeenCalledTimes(3);
    expect(result.current.connectingAgents).toBe(false);
    expect(result.current.runtimeInventoryError).toBeNull();

    await sleep(100);
    expect(listAgents).toHaveBeenCalledTimes(3);
  });

  it('keeps retrying at the last backoff step while the daemon stays unreachable', async () => {
    const listAgents = vi.fn<ChatPaneRuntimeAccess['listAgents']>(async () => {
      throw new Error('GET /api/agents answered 500');
    });
    const access = runtimeAccess({ listAgents });
    const { result } = renderHook(() => useChatPaneRuntimeInventory({
      access,
      pollIntervalMs: 60_000,
      retryDelaysMs: [5, 10],
    }));

    await waitFor(() => expect(listAgents.mock.calls.length).toBeGreaterThanOrEqual(4));
    expect(result.current.connectingAgents).toBe(true);
  });

  it('refetches the inventory as soon as the daemon comes back online', async () => {
    const listAgents = vi
      .fn<ChatPaneRuntimeAccess['listAgents']>()
      .mockRejectedValueOnce(new Error('GET /api/agents answered 500'))
      .mockResolvedValueOnce([{ id: 'claude', name: 'Claude' }]);
    let online = false;
    const access = runtimeAccess({ listAgents, daemonOnline: vi.fn(async () => online) });
    const { result } = renderHook(() => useChatPaneRuntimeInventory({
      access,
      pollIntervalMs: 10,
      retryDelaysMs: [60_000],
    }));

    await act(async () => {});
    expect(result.current.daemonOnline).toBe(false);
    expect(listAgents).toHaveBeenCalledTimes(1);

    online = true;
    await waitFor(() => expect(result.current.agents).toEqual([{ id: 'claude', name: 'Claude' }]));
    expect(result.current.daemonOnline).toBe(true);
    expect(listAgents).toHaveBeenCalledTimes(2);
    expect(result.current.connectingAgents).toBe(false);
  });

  it('does not refetch on the first online report, only on an offline-to-online transition', async () => {
    const listAgents = vi.fn<ChatPaneRuntimeAccess['listAgents']>(async () => {
      throw new Error('GET /api/agents answered 500');
    });
    const daemonOnline = vi.fn(async () => true);
    const access = runtimeAccess({ listAgents, daemonOnline });
    renderHook(() => useChatPaneRuntimeInventory({
      access,
      pollIntervalMs: 10,
      retryDelaysMs: [60_000],
    }));

    await waitFor(() => expect(daemonOnline.mock.calls.length).toBeGreaterThanOrEqual(4));
    expect(listAgents).toHaveBeenCalledTimes(1);
  });

  it('refetches on window focus and on the tab becoming visible while no answer has arrived', async () => {
    const listAgents = vi
      .fn<ChatPaneRuntimeAccess['listAgents']>()
      .mockRejectedValueOnce(new Error('GET /api/agents answered 500'))
      .mockRejectedValueOnce(new Error('GET /api/agents answered 500'))
      .mockResolvedValue([{ id: 'claude', name: 'Claude' }]);
    const access = runtimeAccess({ listAgents });
    const { result } = renderHook(() => useChatPaneRuntimeInventory({
      access,
      retryDelaysMs: [60_000],
    }));
    await act(async () => {});
    expect(listAgents).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(listAgents).toHaveBeenCalledTimes(2);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(listAgents).toHaveBeenCalledTimes(3);
    expect(result.current.agents).toEqual([{ id: 'claude', name: 'Claude' }]);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(listAgents).toHaveBeenCalledTimes(3);
  });

  it('polls health only while the tab is visible, checking once when it is shown again', async () => {
    vi.useFakeTimers();
    const access = runtimeAccess();
    const { unmount } = renderHook(() => useChatPaneRuntimeInventory({ access, pollIntervalMs: 100 }));
    await act(async () => {});
    expect(access.daemonOnline).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(100));
    expect(access.daemonOnline).toHaveBeenCalledTimes(2);

    await act(async () => setVisibility('hidden'));
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(access.daemonOnline).toHaveBeenCalledTimes(2);

    await act(async () => setVisibility('visible'));
    expect(access.daemonOnline).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTime(100));
    expect(access.daemonOnline).toHaveBeenCalledTimes(4);

    unmount();
    await act(async () => setVisibility('visible'));
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(access.daemonOnline).toHaveBeenCalledTimes(4);
  });

  it('starts no health interval when mounted in a hidden tab, but still checks once', async () => {
    vi.useFakeTimers();
    setVisibility('hidden', false);
    const access = runtimeAccess();
    renderHook(() => useChatPaneRuntimeInventory({ access, pollIntervalMs: 100 }));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(access.daemonOnline).toHaveBeenCalledTimes(1);
  });

  it('skips a health tick while the previous status call is still in flight', async () => {
    vi.useFakeTimers();
    const pending = deferred<boolean>();
    const daemonOnline = vi.fn<ChatPaneRuntimeAccess['daemonOnline']>().mockReturnValueOnce(pending.promise).mockResolvedValue(true);
    const access = runtimeAccess({ daemonOnline });
    const { result } = renderHook(() => useChatPaneRuntimeInventory({ access, pollIntervalMs: 100 }));
    await act(async () => {});

    await act(async () => vi.advanceTimersByTime(300));
    expect(daemonOnline).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(true));
    expect(result.current.daemonOnline).toBe(true);
    await act(async () => vi.advanceTimersByTime(100));
    expect(daemonOnline).toHaveBeenCalledTimes(2);
  });

  it('treats a resolved empty list as a finished answer, not something to retry', async () => {
    const listAgents = vi.fn<ChatPaneRuntimeAccess['listAgents']>(async () => []);
    const access = runtimeAccess({ listAgents });
    const { result } = renderHook(() => useChatPaneRuntimeInventory({
      access,
      retryDelaysMs: [5],
    }));
    await act(async () => {});
    await sleep(50);
    expect(listAgents).toHaveBeenCalledTimes(1);
    expect(result.current.connectingAgents).toBe(false);
  });

  it('starts scanningAgents true synchronously when access is supplied at mount', async () => {
    // The load effect only flips `scanningAgents` to `true` once it runs, which is after the
    // first paint. If the initial state were `false` there would be one rendered frame where
    // detection is neither loaded nor marked as loading — the frame that used to make
    // `ChatPane`'s "No usable CLI" banner flash on reload. Asserted with no `act()` in between so
    // this reads the very first synchronous render, before the effect has any chance to run.
    const access = runtimeAccess({
      listAgents: vi.fn(() => new Promise<ChatPaneAgent[]>(() => {})),
    });
    const { result } = renderHook(() => useChatPaneRuntimeInventory({ access }));
    expect(result.current.scanningAgents).toBe(true);
  });

  it('starts scanningAgents false synchronously when no access is supplied at mount', () => {
    const { result } = renderHook(() => useChatPaneRuntimeInventory({
      initialAgents: [{ id: 'static', name: 'Static' }],
    }));
    expect(result.current.scanningAgents).toBe(false);
  });

  it('safely no-ops explicit inventory actions when runtime access is absent', async () => {
    const { result } = renderHook(() => useChatPaneRuntimeInventory({
      initialAgents: [{ id: 'static', name: 'Static' }],
    }));
    await act(() => result.current.rescanAgents());
    expect(result.current.agents[0]?.id).toBe('static');
    expect(result.current.daemonOnline).toBe(false);
  });
});
