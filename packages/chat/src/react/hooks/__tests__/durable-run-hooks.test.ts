import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeChatTransport } from '../testing/fake-transport.js';
import { useRunStream } from '../useRunStream.js';
import { useConversation } from '../useConversation.js';

const partial = 'Need a repo-creation tool. Check the github plugin skill and capabilities.\n\nCreating the repo via the saved `github` credential.\n\nRepo created (private, `main`). Now the backup plan.';
describe('durable run hooks', () => {
  it('preserves the seeded incident when an interrupted subscription completes empty', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useRunStream({ transport }));
    await act(async () => result.current.reattach('old', [{ kind: 'text', text: partial }]));
    act(() => transport.reattachCalls[0]!.handlers.onDone([]));
    expect(result.current.events).toEqual([{ kind: 'text', text: partial }]);
  });
  it('keeps persisted content when a failed stream has no text events', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useConversation({ transport, initialMessages: [{ id: 'm', role: 'assistant', content: partial, runId: 'old', runStatus: 'running' }] }));
    await act(async () => {});
    act(() => { transport.reattachCalls[0]!.handlers.onError(new Error('Stopped.')); transport.reattachCalls[0]!.handlers.onDone([]); });
    expect(result.current.messages[0]!.content).toBe(partial);
    expect(result.current.messages[0]!.runStatus).toBe('failed');
  });
  it('follows a new attempt and preserves user cancellation on completion', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useRunStream({ transport }));
    await act(async () => result.current.reattach('old'));
    act(() => transport.reattachCalls[0]!.handlers.onCheckpoint!({ id: 'm', role: 'assistant', content: partial, events: [{ kind: 'text', text: partial }], runId: 'new', runStatus: 'canceled' }));
    act(() => transport.reattachCalls[0]!.handlers.onDone([]));
    expect(result.current.runId).toBe('new');
    expect(result.current.status).toBe('canceled');
    expect(result.current.events).toEqual([{ kind: 'text', text: partial }]);
  });
});
