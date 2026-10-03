import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { createVibecodingSession } from '../session.js';
import { useVibecodingSession } from '../use-vibecoding-session.js';
import type { EditTarget } from '../../core/target.js';
import type { PartId, Snapshot } from '../../core/types.js';

function makeTarget(initial: Record<PartId, string> = {}): EditTarget {
  const parts = new Map<PartId, string>(Object.entries(initial));
  return {
    listParts: async () => [...parts.keys()].map((id) => ({ id })),
    readPart: async ({ id }) => {
      const found = parts.get(id);
      if (found === undefined) throw new Error(`no such part: ${id}`);
      return found;
    },
    replacePart: async ({ id, content }) => {
      parts.set(id, content);
    },
    snapshot: async (): Promise<Snapshot> => ({ id: 'snap', parts: Object.fromEntries(parts) }),
    restore: async ({ snapshot }) => {
      parts.clear();
      for (const [id, content] of Object.entries(snapshot.parts)) parts.set(id, content);
    },
    validate: async () => ({ ok: true }),
  };
}

describe('useVibecodingSession', () => {
  test('triggers refresh() on mount and reflects the resulting parts', async () => {
    const session = createVibecodingSession({ target: makeTarget({ a: 'A' }) });
    const { result } = renderHook(() => useVibecodingSession({ session }));

    // `'idle'` is real but not reliably observable here: `renderHook` flushes the mount effect
    // (which calls `session.refresh()`) inside the same `act()` as the initial render, and
    // `refresh()`'s first commit (`status: 'loading'`) happens synchronously before its first
    // `await` — so by the time this assertion runs, the session has already moved past `'idle'`.
    expect(['idle', 'loading']).toContain(result.current.status);

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.parts).toEqual([{ id: 'a' }]);
  });

  test('applyEdits/undo/redo bound to the hook drive the same underlying session', async () => {
    const session = createVibecodingSession({ target: makeTarget({ a: 'a0' }) });
    const { result } = renderHook(() => useVibecodingSession({ session }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.applyEdits({ edits: [{ id: 'a', content: 'a1' }] });
    });
    expect(result.current.partContent.get('a')).toBe('a1');
    expect(result.current.canUndo).toBe(true);

    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.partContent.get('a')).toBe('a0');
    expect(result.current.canRedo).toBe(true);
  });

  test('switching to a different session re-triggers refresh against the new one', async () => {
    const sessionA = createVibecodingSession({ target: makeTarget({ a: 'A' }) });
    const sessionB = createVibecodingSession({ target: makeTarget({ b: 'B' }) });
    const { result, rerender } = renderHook(({ session }) => useVibecodingSession({ session }), {
      initialProps: { session: sessionA },
    });
    await waitFor(() => expect(result.current.parts).toEqual([{ id: 'a' }]));

    rerender({ session: sessionB });

    await waitFor(() => expect(result.current.parts).toEqual([{ id: 'b' }]));
  });

  test('object subscriptions stay stable across renders and detach when the session changes', async () => {
    const sessionA = createVibecodingSession({ target: makeTarget({ a: 'A' }) });
    const sessionB = createVibecodingSession({ target: makeTarget({ b: 'B' }) });
    const unsubscribeA = vi.fn();
    const originalSubscribe = sessionA.subscribe;
    const subscribeA = vi.spyOn(sessionA, 'subscribe').mockImplementation((args) => {
      const unsubscribe = originalSubscribe(args);
      return () => { unsubscribeA(); unsubscribe(); };
    });
    const subscribeB = vi.spyOn(sessionB, 'subscribe');
    const { result, rerender, unmount } = renderHook(({ session }) => useVibecodingSession({ session }), {
      initialProps: { session: sessionA },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(subscribeA).toHaveBeenCalledTimes(1);
    expect(typeof subscribeA.mock.calls[0]?.[0].listener).toBe('function');

    rerender({ session: sessionA });
    expect(subscribeA).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await result.current.readPart({ id: 'a' })).toBe('A');
      await result.current.applyEdits({ edits: [{ id: 'a', content: 'edited' }] }, { label: 'hook turn' });
    });
    expect(sessionA.history.entries()[0]?.label).toBe('hook turn');
    expect(subscribeA).toHaveBeenCalledTimes(1);

    rerender({ session: sessionB });
    await waitFor(() => expect(result.current.parts).toEqual([{ id: 'b' }]));
    expect(unsubscribeA).toHaveBeenCalledTimes(1);
    expect(subscribeB).toHaveBeenCalledTimes(1);
    unmount();
  });
});
