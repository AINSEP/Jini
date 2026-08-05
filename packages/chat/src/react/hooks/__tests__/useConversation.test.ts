import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatTransport, RunHandlers } from '../../../core/index.js';
import { useConversation } from '../useConversation.js';
import { createFakeChatTransport } from '../testing/fake-transport.js';

describe('useConversation', () => {
  it('appends an optimistic user message and a placeholder assistant message on sendMessage', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useConversation({ transport }));

    await act(async () => {
      await result.current.sendMessage('hi there');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'hi there' });
    // By the time the `sendMessage` promise settles, `useRunStream` has
    // already transitioned to 'streaming' and the reconciliation effect has
    // flushed (act() awaits effects too), so the placeholder's initial
    // 'queued' status is immediately superseded by 'running'.
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', runStatus: 'running' });
    expect(result.current.isStreaming).toBe(true);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.input.history.map((m) => m.content)).toEqual(['hi there']);
  });

  it('reconciles streamed events onto the assistant message content and finalizes on done', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useConversation({ transport }));

    await act(async () => {
      await result.current.sendMessage('write a haiku');
    });

    act(() => transport.emit({ kind: 'text', text: 'old pond' }));
    act(() => transport.emit({ kind: 'text', text: '...frog leaps in' }));

    const assistant = result.current.messages[1]!;
    expect(assistant.content).toBe('old pond...frog leaps in');
    expect(assistant.events).toHaveLength(2);
    expect(assistant.runStatus).toBe('running');

    act(() => transport.finish());
    expect(result.current.messages[1]!.runStatus).toBe('succeeded');
    expect(result.current.isStreaming).toBe(false);
  });

  it('marks the assistant message failed and surfaces the error on transport failure', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useConversation({ transport }));
    await act(async () => {
      await result.current.sendMessage('do a thing');
    });
    act(() => transport.fail(new Error('daemon disconnected')));
    expect(result.current.messages[1]!.runStatus).toBe('failed');
    expect(result.current.error?.message).toBe('daemon disconnected');
  });

  it('cancel() marks the in-flight assistant message canceled', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useConversation({ transport }));
    await act(async () => {
      await result.current.sendMessage('long task');
    });
    act(() => result.current.cancel());
    expect(result.current.messages[1]!.runStatus).toBe('canceled');
    expect(transport.stoppedRunIds).toEqual(['run-1']);
  });

  it('retry() re-sends history up to (and including) the prior user turn, replacing the failed assistant message', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useConversation({ transport }));
    await act(async () => {
      await result.current.sendMessage('first attempt');
    });
    act(() => transport.fail(new Error('network blip')));
    const failedId = result.current.messages[1]!.id;

    await act(async () => {
      await result.current.retry(failedId);
    });
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]?.input.history.map((m) => m.content)).toEqual(['first attempt']);
    expect(result.current.messages[1]!.content).toBe('');
    expect(result.current.messages[1]!.runStatus).toBe('running');

    act(() => transport.emit({ kind: 'text', text: 'recovered' }));
    expect(result.current.messages[1]!.content).toBe('recovered');
  });

  /**
   * `retry` located the prior user turn and then used it only for the role guard, so its
   * attachments never went back out — `sendMessage` forwards them to `start`, this path did not.
   * Retrying an image prompt re-sent the text ALONE, and the model answered about a picture it
   * could no longer see, while the transcript still rendered the attachment beside the user turn.
   */
  it('retry() re-sends the prior user turn’s attachments, not just its text', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useConversation({ transport }));
    const attachments = [{ path: '/tmp/shot.png', name: 'shot.png', kind: 'image' as const }];
    await act(async () => {
      await result.current.sendMessage('what is wrong with this?', { attachments });
    });
    expect(transport.calls[0]?.input.attachments).toEqual(attachments);

    act(() => transport.fail(new Error('network blip')));
    const failedId = result.current.messages[1]!.id;
    await act(async () => {
      await result.current.retry(failedId);
    });

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]?.input.attachments).toEqual(attachments);
  });

  it('setMessages accepts both a plain array and an updater function', () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useConversation({ transport }));

    act(() => result.current.setMessages([{ id: 'x1', role: 'user', content: 'direct set' }]));
    expect(result.current.messages).toEqual([{ id: 'x1', role: 'user', content: 'direct set' }]);

    act(() => result.current.setMessages((prev) => [...prev, { id: 'x2', role: 'user', content: 'via updater' }]));
    expect(result.current.messages.map((m) => m.content)).toEqual(['direct set', 'via updater']);
  });

  it('falls back to a counter-based id when crypto.randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const transport = createFakeChatTransport();
      const { result } = renderHook(() => useConversation({ transport }));
      await act(async () => {
        await result.current.sendMessage('no crypto here');
      });
      expect(result.current.messages[0]!.id).toMatch(/^msg-\d+-\d+$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('threads attachments/context/a per-send agentId override through to the transport and the assistant message', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useConversation({ transport, agentId: 'default-agent' }));
    const attachments = [{ path: '/a.png', name: 'a.png', kind: 'image' as const }];
    const context = { projectId: 'p1' };

    await act(async () => {
      await result.current.sendMessage('with extras', { attachments, context, agentId: 'override-agent' });
    });

    expect(transport.calls[0]?.input.attachments).toEqual(attachments);
    expect(transport.calls[0]?.input.context).toEqual(context);
    expect(transport.calls[0]?.input.agentId).toBe('override-agent');
    expect(result.current.messages[0]).toMatchObject({ attachments });
    expect(result.current.messages[1]).toMatchObject({ agentId: 'override-agent' });
  });

  it('falls back to the hook-level agentId when sendMessage/retry are not given a per-call override', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useConversation({ transport, agentId: 'hook-level-agent' }));

    await act(async () => {
      await result.current.sendMessage('no override');
    });
    expect(transport.calls[0]?.input.agentId).toBe('hook-level-agent');

    act(() => transport.fail(new Error('boom')));
    const failedId = result.current.messages[1]!.id;
    await act(async () => {
      await result.current.retry(failedId);
    });
    expect(transport.calls[1]?.input.agentId).toBe('hook-level-agent');
  });

  it('retry() no-ops for an unknown message id (idx <= 0 guard)', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useConversation({ transport }));
    await act(async () => {
      await result.current.sendMessage('first');
    });
    const before = result.current.messages;
    await act(async () => {
      await result.current.retry('does-not-exist');
    });
    expect(result.current.messages).toBe(before);
    expect(transport.calls).toHaveLength(1);
  });

  it('retry() no-ops when the preceding message is not a user turn', async () => {
    const transport = createFakeChatTransport();
    const seed = [
      { id: 'sys-1', role: 'assistant' as const, content: 'system-ish preamble' },
      { id: 'asst-1', role: 'assistant' as const, content: 'broken', runStatus: 'failed' as const },
    ];
    const { result } = renderHook(() => useConversation({ transport, initialMessages: seed }));
    await act(async () => {
      await result.current.retry('asst-1');
    });
    expect(result.current.messages).toEqual(seed);
    expect(transport.calls).toHaveLength(0);
  });

  it('an event arriving before start() resolves its runId leaves the brand-new assistant message without a runId until the promise settles', async () => {
    let resolveStart!: (v: { runId: string }) => void;
    const startPromise = new Promise<{ runId: string }>((resolve) => {
      resolveStart = resolve;
    });
    let capturedHandlers: RunHandlers | undefined;
    const transport = {
      startRun: vi.fn((_input: unknown, handlers: RunHandlers) => {
        capturedHandlers = handlers;
        return startPromise;
      }),
      reattachRun: vi.fn(),
      stopRun: vi.fn(),
      fetchRunStatus: vi.fn(),
    } as unknown as ChatTransport;
    const { result } = renderHook(() => useConversation({ transport }));

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage('hi');
    });
    // `run.runId` is still null (startRun hasn't resolved yet) and the
    // freshly-created assistant message never had one either — the `runId`
    // field must simply be omitted, not set to `undefined`.
    act(() => capturedHandlers?.onEvent({ kind: 'text', text: 'partial' }));
    expect(result.current.messages[1]!.runId).toBeUndefined();
    expect(result.current.messages[1]!.content).toBe('partial');

    resolveStart({ runId: 'run-1' });
    await act(async () => {
      await sendPromise;
    });
    expect(result.current.messages[1]!.runId).toBe('run-1');
  });

  it('an event arriving before retry() resolves its runId falls back to the message\'s prior runId from the failed attempt', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useConversation({ transport }));

    await act(async () => {
      await result.current.sendMessage('first attempt');
    });
    act(() => transport.fail(new Error('network blip')));
    const failedId = result.current.messages[1]!.id;
    expect(result.current.messages[1]!.runId).toBe('run-1');

    let resolveRetry!: (v: { runId: string }) => void;
    const retryPromise = new Promise<{ runId: string }>((resolve) => {
      resolveRetry = resolve;
    });
    let capturedHandlers: RunHandlers | undefined;
    (transport as unknown as { startRun: unknown }).startRun = vi.fn((_input: unknown, handlers: RunHandlers) => {
      capturedHandlers = handlers;
      return retryPromise;
    });

    let retryDone!: Promise<void>;
    act(() => {
      retryDone = result.current.retry(failedId);
    });
    // `run.runId` is still null (the new startRun hasn't resolved yet), but
    // the retried message already carries `run-1` from the failed attempt —
    // that prior id is kept as a fallback rather than dropped.
    act(() => capturedHandlers?.onEvent({ kind: 'text', text: 'still going' }));
    expect(result.current.messages[1]!.runId).toBe('run-1');

    resolveRetry({ runId: 'run-2' });
    await act(async () => {
      await retryDone;
    });
    expect(result.current.messages[1]!.runId).toBe('run-2');
  });

  it('seeds from initialMessages and preserves them across a new turn', async () => {
    const transport = createFakeChatTransport();
    const seed = [{ id: 'seed-1', role: 'user' as const, content: 'earlier turn' }];
    const { result } = renderHook(() => useConversation({ transport, initialMessages: seed }));
    expect(result.current.messages).toEqual(seed);

    await act(async () => {
      await result.current.sendMessage('follow up');
    });
    expect(result.current.messages).toHaveLength(3);
    expect(transport.calls[0]?.input.history.map((m) => m.content)).toEqual(['earlier turn', 'follow up']);
  });
});
