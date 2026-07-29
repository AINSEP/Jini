import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatTransport } from '@jini-ai/chat-core';
import { useRunStream } from '../useRunStream.js';
import { createFakeChatTransport } from '../testing/fake-transport.js';

describe('useRunStream', () => {
  it('starts idle', () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useRunStream(transport));
    expect(result.current.status).toBe('idle');
    expect(result.current.events).toEqual([]);
    expect(result.current.runId).toBeNull();
  });

  it('streams events from start() and accumulates them in order', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useRunStream(transport));

    await act(async () => {
      await result.current.start({ history: [] });
    });
    expect(result.current.runId).toBe('run-1');
    expect(result.current.isStreaming).toBe(true);

    act(() => transport.emit({ kind: 'text', text: 'hello' }));
    expect(result.current.events).toEqual([{ kind: 'text', text: 'hello' }]);

    act(() => transport.emit({ kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }));
    expect(result.current.events).toHaveLength(2);

    act(() => transport.finish());
    expect(result.current.status).toBe('done');
  });

  it('buffers live tool-input deltas by tool id, ephemeral only', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useRunStream(transport));
    await act(async () => {
      await result.current.start({ history: [] });
    });
    act(() => transport.emitToolInputDelta('t1', 'Write', '{"file'));
    act(() => transport.emitToolInputDelta('t1', 'Write', '_path":"a.txt"}'));
    expect(result.current.toolInputDeltas.t1).toBe('{"file_path":"a.txt"}');
    // A fresh start() must clear stale deltas from the previous run.
    await act(async () => {
      await result.current.start({ history: [] });
    });
    expect(result.current.toolInputDeltas).toEqual({});
  });

  it('surfaces transport errors via onError', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useRunStream(transport));
    await act(async () => {
      await result.current.start({ history: [] });
    });
    act(() => transport.fail(new Error('boom')));
    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('boom');
  });

  it('cancel() stops the run via the transport and marks status canceled', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useRunStream(transport));
    await act(async () => {
      await result.current.start({ history: [] });
    });
    act(() => result.current.cancel());
    expect(result.current.status).toBe('canceled');
    expect(transport.stoppedRunIds).toEqual(['run-1']);

    // A late event from the aborted subscription must not resurrect state —
    // this is the stale-generation guard.
    act(() => transport.emit({ kind: 'text', text: 'too-late' }));
    expect(result.current.events).toEqual([]);
    expect(result.current.status).toBe('canceled');
  });

  it('reattach() resumes an existing run, seeded with prior persisted events, then keeps streaming', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useRunStream(transport));
    const priorEvents = [{ kind: 'text' as const, text: 'earlier' }];

    await act(async () => {
      await result.current.reattach('run-existing', priorEvents);
    });
    expect(result.current.runId).toBe('run-existing');
    expect(result.current.events).toEqual(priorEvents);
    expect(result.current.isStreaming).toBe(true);
    expect(transport.reattachCalls).toHaveLength(1);
    expect(transport.reattachCalls[0]?.runId).toBe('run-existing');

    act(() => transport.emit({ kind: 'text', text: ' more' }));
    expect(result.current.events).toEqual([...priorEvents, { kind: 'text', text: ' more' }]);

    act(() => transport.finish());
    expect(result.current.status).toBe('done');
  });

  it('a second start() supersedes the first — stale-generation events from the first are dropped', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useRunStream(transport));

    await act(async () => {
      await result.current.start({ history: [] });
    });
    const firstRunHandlers = transport.calls[0]!.handlers;

    await act(async () => {
      await result.current.start({ history: [] });
    });
    expect(result.current.runId).toBe('run-2');

    // Simulate a straggling callback from the first (superseded) subscription.
    act(() => firstRunHandlers.onEvent({ kind: 'text', text: 'stale' }));
    expect(result.current.events).toEqual([]);

    act(() => transport.emit({ kind: 'text', text: 'fresh' }));
    expect(result.current.events).toEqual([{ kind: 'text', text: 'fresh' }]);
  });

  it('reset() clears state back to idle without calling the transport', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useRunStream(transport));
    await act(async () => {
      await result.current.start({ history: [] });
    });
    act(() => transport.emit({ kind: 'text', text: 'x' }));
    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');
    expect(result.current.events).toEqual([]);
    expect(result.current.runId).toBeNull();
    expect(transport.stoppedRunIds).toEqual([]);
  });

  it('start() wraps a non-Error rejection from transport.startRun via toError, and preserves a real Error message as-is', async () => {
    const transport = {
      startRun: vi.fn().mockRejectedValueOnce('boom-string').mockRejectedValueOnce(new Error('boom-error')),
      reattachRun: vi.fn(),
      stopRun: vi.fn(),
      fetchRunStatus: vi.fn(),
    } as unknown as ChatTransport;
    const { result } = renderHook(() => useRunStream(transport));

    await act(async () => {
      await result.current.start({ history: [] });
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('boom-string');

    await act(async () => {
      await result.current.start({ history: [] });
    });
    expect(result.current.error?.message).toBe('boom-error');
  });

  it('reattach() also wraps a non-Error rejection from transport.reattachRun via toError, and preserves a real Error as-is', async () => {
    const transport = {
      startRun: vi.fn(),
      reattachRun: vi.fn().mockRejectedValueOnce(404).mockRejectedValueOnce(new Error('reattach failed')),
      stopRun: vi.fn(),
      fetchRunStatus: vi.fn(),
    } as unknown as ChatTransport;
    const { result } = renderHook(() => useRunStream(transport));

    await act(async () => {
      await result.current.reattach('run-x');
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('404');

    await act(async () => {
      await result.current.reattach('run-y');
    });
    expect(result.current.error?.message).toBe('reattach failed');
  });

  it('a superseded start() whose transport promise later resolves still returns the runId, but must not clobber the newer state', async () => {
    let resolveFirst!: (v: { runId: string }) => void;
    const firstPromise = new Promise<{ runId: string }>((resolve) => {
      resolveFirst = resolve;
    });
    let callCount = 0;
    const transport = {
      startRun: vi.fn(async () => {
        callCount += 1;
        return callCount === 1 ? firstPromise : { runId: 'run-2' };
      }),
      reattachRun: vi.fn(),
      stopRun: vi.fn(),
      fetchRunStatus: vi.fn(),
    } as unknown as ChatTransport;
    const { result } = renderHook(() => useRunStream(transport));

    let firstCall!: Promise<{ runId: string } | null>;
    act(() => {
      firstCall = result.current.start({ history: [] });
    });
    await act(async () => {
      await result.current.start({ history: [] });
    });
    expect(result.current.runId).toBe('run-2');

    resolveFirst({ runId: 'run-1' });
    let firstResult: { runId: string } | null = null;
    await act(async () => {
      firstResult = await firstCall;
    });
    expect(firstResult).toEqual({ runId: 'run-1' });
    // The stale resolution must not have overwritten the current (run-2) state.
    expect(result.current.runId).toBe('run-2');
  });

  it('a superseded start() whose transport promise later rejects is silently dropped (stale-generation catch guard)', async () => {
    let rejectFirst!: (err: unknown) => void;
    const firstPromise = new Promise<{ runId: string }>((_resolve, reject) => {
      rejectFirst = reject;
    });
    let callCount = 0;
    const transport = {
      startRun: vi.fn(async () => {
        callCount += 1;
        return callCount === 1 ? firstPromise : { runId: 'run-2' };
      }),
      reattachRun: vi.fn(),
      stopRun: vi.fn(),
      fetchRunStatus: vi.fn(),
    } as unknown as ChatTransport;
    const { result } = renderHook(() => useRunStream(transport));

    let firstCall!: Promise<{ runId: string } | null>;
    act(() => {
      firstCall = result.current.start({ history: [] });
    });
    await act(async () => {
      await result.current.start({ history: [] });
    });
    expect(result.current.runId).toBe('run-2');

    rejectFirst(new Error('late failure'));
    let firstResult: { runId: string } | null = { runId: 'sentinel' };
    await act(async () => {
      firstResult = await firstCall;
    });
    expect(firstResult).toBeNull();
    // The stale rejection must not have flipped status to error.
    expect(result.current.status).toBe('streaming');
    expect(result.current.runId).toBe('run-2');
  });

  it('onDone after onError keeps status "error" rather than overwriting it to "done"', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useRunStream(transport));
    await act(async () => {
      await result.current.start({ history: [] });
    });
    act(() => transport.fail(new Error('boom')));
    expect(result.current.status).toBe('error');

    act(() => transport.finish([{ kind: 'text', text: 'late final events' }]));
    expect(result.current.status).toBe('error');
    expect(result.current.events).toEqual([{ kind: 'text', text: 'late final events' }]);
  });

  it('stale-generation onToolInputDelta/onError/onDone callbacks from a superseded start() are all dropped', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useRunStream(transport));

    await act(async () => {
      await result.current.start({ history: [] });
    });
    const firstRunHandlers = transport.calls[0]!.handlers;

    await act(async () => {
      await result.current.start({ history: [] });
    });
    expect(result.current.runId).toBe('run-2');

    // Straggling callbacks from the first (superseded) subscription must
    // all be no-ops — each handler has its own `isStale()` early return.
    act(() => firstRunHandlers.onToolInputDelta?.('t1', 'Write', '{"stale'));
    expect(result.current.toolInputDeltas).toEqual({});

    act(() => firstRunHandlers.onError(new Error('stale error')));
    expect(result.current.status).toBe('streaming');
    expect(result.current.error).toBeNull();

    act(() => firstRunHandlers.onDone([{ kind: 'text', text: 'stale done' }]));
    expect(result.current.status).toBe('streaming');
    expect(result.current.events).toEqual([]);
  });

  it('a superseded reattach() whose transport promise later rejects is silently dropped (stale-generation catch guard)', async () => {
    let rejectFirst!: (err: unknown) => void;
    const firstPromise = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    let callCount = 0;
    const transport = {
      startRun: vi.fn(),
      reattachRun: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) return firstPromise;
        return undefined;
      }),
      stopRun: vi.fn(),
      fetchRunStatus: vi.fn(),
    } as unknown as ChatTransport;
    const { result } = renderHook(() => useRunStream(transport));

    act(() => {
      void result.current.reattach('run-a');
    });
    await act(async () => {
      await result.current.reattach('run-b');
    });
    expect(result.current.runId).toBe('run-b');

    rejectFirst(new Error('late reattach failure'));
    // Flush microtasks so the superseded reattach()'s catch runs.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('streaming');
    expect(result.current.runId).toBe('run-b');
  });
});
