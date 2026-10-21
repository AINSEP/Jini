import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatTransport } from '../../../core/index.js';
import { useRunStream } from '../useRunStream.js';
import { createFakeChatTransport } from '../testing/fake-transport.js';

/**
 * Durable checkpoints (`onCheckpoint`) carry a saved snapshot of the run's assistant message. They
 * fold into the live state field by field: whatever the snapshot omits keeps its live value, and a
 * checkpoint from a superseded run generation is ignored entirely.
 */
function checkpoint(fields: Partial<ChatMessage>): ChatMessage {
  return { id: 'a1', role: 'assistant', content: '', ...fields };
}

async function startedRun() {
  const transport = createFakeChatTransport();
  const hook = renderHook(() => useRunStream({ transport }));
  await act(async () => {
    await hook.result.current.start({ history: [] });
  });
  return { transport, ...hook };
}

describe('useRunStream onCheckpoint', () => {
  it.each([
    ['queued', 'streaming'],
    ['running', 'streaming'],
    ['succeeded', 'done'],
    ['failed', 'error'],
    ['canceled', 'canceled'],
  ] as const)('maps a %s checkpoint to the %s stream status and adopts its run id and events', async (runStatus, status) => {
    const { transport, result } = await startedRun();
    act(() => transport.calls[0]!.handlers.onCheckpoint?.(checkpoint({
      runId: 'run-durable', runStatus, events: [{ kind: 'text', text: 'saved' }],
    })));
    expect(result.current.status).toBe(status);
    expect(result.current.runId).toBe('run-durable');
    expect(result.current.events).toEqual([{ kind: 'text', text: 'saved' }]);
  });

  it('keeps the live run id, status and events for whatever the snapshot omits', async () => {
    const { transport, result } = await startedRun();
    act(() => transport.emit({ kind: 'text', text: 'live' }));
    act(() => transport.calls[0]!.handlers.onCheckpoint?.(checkpoint({})));
    expect(result.current.runId).toBe('run-1');
    expect(result.current.status).toBe('streaming');
    expect(result.current.events).toEqual([{ kind: 'text', text: 'live' }]);
  });

  it('ignores a checkpoint delivered to a superseded run generation', async () => {
    const { transport, result } = await startedRun();
    await act(async () => {
      await result.current.start({ history: [] });
    });
    act(() => transport.calls[0]!.handlers.onCheckpoint?.(checkpoint({
      runId: 'stale-run', runStatus: 'succeeded', events: [{ kind: 'text', text: 'old' }],
    })));
    expect(result.current.runId).toBe('run-2');
    expect(result.current.status).toBe('streaming');
    expect(result.current.events).toEqual([]);
  });
});

describe('useRunStream stopRun host effect', () => {
  it('cancel() reports a synchronously throwing transport.stopRun and still cancels', async () => {
    const failure = new Error('stopRun threw before returning a promise');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const transport = {
      startRun: vi.fn().mockResolvedValue({ runId: 'run-1' }),
      reattachRun: vi.fn(),
      stopRun: vi.fn(() => { throw failure; }),
      fetchRunStatus: vi.fn(),
    } as unknown as ChatTransport;
    const { result } = renderHook(() => useRunStream({ transport }));
    try {
      await act(async () => {
        await result.current.start({ history: [] });
      });
      act(() => result.current.cancel());

      expect(result.current.status).toBe('canceled');
      expect(transport.stopRun).toHaveBeenCalledWith('run-1');
      expect(consoleError).toHaveBeenCalledWith(
        '[@jini-ai/chat] useRunStream transport.stopRun (cancel) host effect failed:',
        failure,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
