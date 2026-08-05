import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatPaneAgent, ChatPaneRuntimeAccess } from '../types.js';
import { useChatPaneRuntimeInventory } from '../react/hooks/useChatPaneRuntimeInventory.hooks.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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

afterEach(() => vi.useRealTimers());

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
