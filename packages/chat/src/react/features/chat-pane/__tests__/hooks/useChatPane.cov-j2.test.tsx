import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { acceptedInputEvent } from '../../../../../core/accepted-input.js';
import type { ChatMessage } from '../../../../../core/index.js';
import { __resetComposerDraftCacheForTests } from '../../../../hooks/composer-draft-cache.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import type { ChatPaneAgent, DeliverMidRunMessage, MidRunMessageDelivery } from '../../types.js';
import { useChatPane, type UseChatPaneOptions } from '../../hooks/useChatPane.hooks.js';

const agents: ChatPaneAgent[] = [{ id: 'claude', name: 'Claude Code', available: true }];
const image = { path: 'attachment:shot', name: 'shot.png', kind: 'image' as const };

/** Starts one run and leaves it streaming, then types `next` into the composer. */
async function startStreamingRun(deliverMidRunMessage: DeliverMidRunMessage | undefined, options: Partial<UseChatPaneOptions> = {}) {
  const transport = createFakeChatTransport();
  const hook = renderHook(() => useChatPane({
    transport, agents, selection: { agentId: 'claude' }, initialDraft: 'first turn',
    ...(deliverMidRunMessage ? { deliverMidRunMessage } : {}),
    ...options,
  }));
  await act(() => hook.result.current.send());
  await waitFor(() => expect(hook.result.current.conversation.messages.at(-1)?.runId).toBe('run-1'));
  expect(hook.result.current.conversation.isStreaming).toBe(true);
  act(() => hook.result.current.composer.setDraft('also fix the footer'));
  return { transport, ...hook };
}

/** An upload that stays in flight until the test calls `complete`. */
function pendingUpload() {
  let complete!: (attachments: typeof image[]) => void;
  const uploadAttachments = () => new Promise<typeof image[]>(resolve => { complete = resolve; });
  return { uploadAttachments, complete: (attachments: typeof image[]) => complete(attachments) };
}

/** The optimistic in-run user bubbles on the newest message. */
function receipts(messages: readonly ChatMessage[]) {
  return (messages.at(-1)?.events ?? []).flatMap(event => acceptedInputEvent({ event })?.data ?? []);
}

function withoutEvents(message: ChatMessage): ChatMessage {
  const { events: _events, ...rest } = message;
  return rest;
}

describe('useChatPane — in-run bubbles', () => {
  beforeEach(() => __resetComposerDraftCacheForTests());

  it('orders a second steering message after the first one already delivered into the run', async () => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'delivered');
    const { result, transport } = await startStreamingRun(deliver);
    // The agent's own output in the same turn is not a user input and never becomes the anchor.
    act(() => transport.emit({ kind: 'text', text: 'Working on the footer' }));

    await act(() => result.current.send());
    act(() => result.current.composer.setDraft('and the header'));
    await act(() => result.current.send());

    expect(result.current.conversation.messages.at(-1)?.events?.[0]).toMatchObject({ kind: 'text', text: 'Working on the footer' });
    const bubbles = receipts(result.current.conversation.messages);
    expect(bubbles.map(bubble => bubble.text)).toEqual(['also fix the footer', 'and the header']);
    expect(bubbles[0]).not.toHaveProperty('afterInputId');
    expect(bubbles[1]).toMatchObject({ afterInputId: bubbles[0]!.id });
  });

  it('adds the first bubble to a running assistant turn whose message carries no events yet', async () => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'delivered');
    const { result } = await startStreamingRun(deliver);
    act(() => result.current.conversation.setMessages(messages => [...messages.slice(0, -1), withoutEvents(messages.at(-1)!)]));
    expect(result.current.conversation.messages.at(-1)?.events).toBeUndefined();

    await act(() => result.current.send());

    expect(deliver).toHaveBeenCalledWith({ runId: 'run-1', text: 'also fix the footer' });
    const bubbles = receipts(result.current.conversation.messages);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toMatchObject({ text: 'also fix the footer', optimistic: true });
    expect(bubbles[0]).not.toHaveProperty('afterInputId');
  });

  it('leaves the transcript alone when it no longer ends with the assistant turn by the time delivery lands', async () => {
    let release!: (outcome: MidRunMessageDelivery) => void;
    const deliver = vi.fn(() => new Promise<MidRunMessageDelivery>(resolve => { release = resolve; }));
    const { result } = await startStreamingRun(deliver);
    let sending!: Promise<void>;
    act(() => { sending = result.current.send(); });
    act(() => result.current.conversation.setMessages(messages => messages.slice(0, -1)));
    const transcript = result.current.conversation.messages;
    expect(transcript.at(-1)?.role).toBe('user');

    await act(async () => { release('delivered'); await sending; });

    expect(result.current.conversation.messages).toEqual(transcript);
    expect(result.current.composer.draft).toBe('');
    expect(result.current.queuedPrompt).toBeNull();
  });
});

describe('useChatPane — guarded prompt sends', () => {
  beforeEach(() => __resetComposerDraftCacheForTests());

  it('starts only one run when two agent-driven prompts arrive before the first has started', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useChatPane({ transport, agents, selection: { agentId: 'claude' } }));

    await act(async () => { await Promise.all([result.current.sendPrompt('first'), result.current.sendPrompt('second')]); });

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.input.history.at(-1)?.content).toBe('first');
  });

  it('does not refill a reset composer when the queued run it was flushing is rejected afterwards', async () => {
    const { result, transport } = await startStreamingRun(undefined);
    await act(() => result.current.send());
    expect(result.current.queuedPrompt).toBe('also fix the footer');
    let rejectStart: ((error: Error) => void) | undefined;
    const startRun = vi.fn((_input: Parameters<typeof transport.startRun>[0]) => new Promise<never>((_resolve, reject) => { rejectStart = reject; }));
    transport.startRun = startRun as unknown as typeof transport.startRun;
    act(() => transport.finish());
    // The finished run flushes the queue: exactly one new run starts, carrying the queued prompt.
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    expect(startRun.mock.calls[0]?.[0].history.at(-1)?.content).toBe('also fix the footer');
    expect(result.current.queuedPrompt).toBeNull();

    act(() => result.current.reset());
    await act(async () => { rejectStart!(new Error('offline')); });

    expect(result.current.composer.draft).toBe('');
    expect(result.current.queuedMessages).toEqual([]);
  });
});

describe('useChatPane — queued messages that own an upload', () => {
  beforeEach(() => __resetComposerDraftCacheForTests());

  it('keeps a screenshot turn queued, same messages and files, when the run stops taking messages as it lands', async () => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'not-running');
    const upload = pendingUpload();
    const { result, transport } = await startStreamingRun(deliver, { uploadAttachments: upload.uploadAttachments });
    let uploading!: Promise<void>;
    act(() => { uploading = result.current.addAttachments([new File(['pixels'], 'shot.png', { type: 'image/png' })]); });
    await act(() => result.current.send());
    const queuedIds = result.current.queuedMessages.map(input => input.id);
    expect(queuedIds).toHaveLength(1);

    await act(async () => { upload.complete([image]); await uploading; });

    await waitFor(() => expect(deliver).toHaveBeenCalledWith({ runId: 'run-1', text: 'also fix the footer', attachments: [image] }));
    await waitFor(() => expect(result.current.queuedMessages.map(input => input.id)).toEqual(queuedIds));
    expect(result.current.queuedMessages[0]?.attachments).toEqual([image]);
    expect(transport.stoppedRunIds).toEqual([]);

    act(() => transport.finish());
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]?.input.attachments).toEqual([image]);
    expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('also fix the footer');
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('canceling a message that owns no upload leaves the uploading message and its late pixels intact', async () => {
    const upload = pendingUpload();
    const { result, transport } = await startStreamingRun(undefined, { uploadAttachments: upload.uploadAttachments });
    await act(() => result.current.send());
    let uploading!: Promise<void>;
    act(() => { uploading = result.current.addAttachments([new File(['pixels'], 'shot.png')]); result.current.composer.setDraft('see screenshot'); });
    await act(() => result.current.send());
    expect(result.current.queuedMessages.map(input => input.text)).toEqual(['also fix the footer', 'see screenshot']);

    act(() => result.current.cancelQueuedMessage({ id: result.current.queuedMessages[0]!.id }));
    expect(result.current.isUploadingAttachments).toBe(true);
    await act(async () => { upload.complete([image]); await uploading; });

    expect(result.current.queuedMessages).toMatchObject([{ text: 'see screenshot', attachments: [image] }]);
    act(() => transport.finish());
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('see screenshot');
    expect(transport.calls[1]?.input.attachments).toEqual([image]);
  });
});
