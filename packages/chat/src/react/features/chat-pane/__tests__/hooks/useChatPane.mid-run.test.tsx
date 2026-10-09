import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetComposerDraftCacheForTests } from '../../../../hooks/composer-draft-cache.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import type { ChatPaneAgent, DeliverMidRunMessage, MidRunMessageDelivery } from '../../types.js';
import { useChatPane } from '../../hooks/useChatPane.hooks.js';

const agents: ChatPaneAgent[] = [{ id: 'claude', name: 'Claude Code', available: true }];

/** Starts one run and leaves it streaming, then types `next` into the composer. */
async function startStreamingRun(deliverMidRunMessage: DeliverMidRunMessage | undefined) {
  const transport = createFakeChatTransport();
  const hook = renderHook(() => useChatPane({
    transport, agents, selection: { agentId: 'claude' }, initialDraft: 'first turn',
    ...(deliverMidRunMessage ? { deliverMidRunMessage } : {}),
  }));
  await act(() => hook.result.current.send());
  await waitFor(() => expect(transport.calls).toHaveLength(1));
  await waitFor(() => expect(hook.result.current.conversation.messages.at(-1)?.runId).toBe('run-1'));
  expect(hook.result.current.conversation.isStreaming).toBe(true);
  act(() => hook.result.current.composer.setDraft('also fix the footer'));
  return { transport, ...hook };
}

describe('useChatPane — a message sent mid-run goes to the running agent', () => {
  beforeEach(() => __resetComposerDraftCacheForTests());

  it('delivers the draft into the live run instead of queueing it, and leaves the run going', async () => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'delivered');
    const { result, transport } = await startStreamingRun(deliver);

    await act(() => result.current.send());

    expect(deliver).toHaveBeenCalledWith({ runId: 'run-1', text: 'also fix the footer' });
    expect(result.current.composer.draft).toBe('');
    expect(result.current.queuedPrompt).toBeNull();
    expect(transport.stoppedRunIds).toEqual([]);
    expect(transport.calls).toHaveLength(1);
    expect(result.current.conversation.isStreaming).toBe(true);
  });

  it('interrupts the run and sends the text as the next turn when the agent cannot take it mid-run', async () => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'unsupported');
    const { result, transport } = await startStreamingRun(deliver);

    await act(() => result.current.send());

    expect(transport.stoppedRunIds).toEqual(['run-1']);
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('also fix the footer');
  });

  it('sends the text next, without stopping the run, when the run is already ending', async () => {
    for (const outcome of ['not-running', 'failed'] as const) {
      const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => outcome);
      const { result, transport, unmount } = await startStreamingRun(deliver);

      await act(() => result.current.send());

      expect(transport.stoppedRunIds).toEqual([]);
      expect(result.current.queuedPrompt).toBe('also fix the footer');
      expect(result.current.composer.draft).toBe('');
      unmount();
    }
  });

  it('keeps the old queue-behind-the-run behavior when the host gives no delivery', async () => {
    const { result, transport } = await startStreamingRun(undefined);

    await act(() => result.current.send());

    expect(result.current.queuedPrompt).toBe('also fix the footer');
    expect(transport.stoppedRunIds).toEqual([]);
  });

  it('queues a turn with attachments rather than delivering text-only into the run', async () => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'delivered');
    const { result } = await startStreamingRun(deliver);
    act(() => result.current.composer.addAttachment({ path: 'attachment:1', name: 'a.png', kind: 'image' }));

    await act(() => result.current.send());

    expect(deliver).not.toHaveBeenCalled();
    expect(result.current.queuedPrompt).toBe('also fix the footer');
  });
});
