import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetComposerDraftCacheForTests } from '../../../../hooks/composer-draft-cache.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import type { ChatPaneAgent, DeliverMidRunMessage, MidRunMessageDelivery } from '../../types.js';
import { acceptedInputEvent, projectAcceptedInputEvents } from '../../../../../core/accepted-input.js';
import { useChatPane, type UseChatPaneOptions } from '../../hooks/useChatPane.hooks.js';

const agents: ChatPaneAgent[] = [{ id: 'claude', name: 'Claude Code', available: true }];

/** Starts one run and leaves it streaming, then types `next` into the composer. */
async function startStreamingRun(deliverMidRunMessage: DeliverMidRunMessage | undefined, options: Partial<UseChatPaneOptions> = {}) {
  const transport = createFakeChatTransport();
  const hook = renderHook(() => useChatPane({
    transport, agents, selection: { agentId: 'claude' }, initialDraft: 'first turn',
    ...(deliverMidRunMessage ? { deliverMidRunMessage } : {}),
    ...options,
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

  it.each(['tool_approval', 'credential_save'])('holds ordinary text behind a pending %s card without rejecting its tool', async name => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => ({ delivery: 'delivered', id: 'relay-1' }));
    const { result, transport } = await startStreamingRun(deliver);
    await act(async () => {
      transport.emit({ kind: 'tool_use', id: 'pending', name, input: {} });
      transport.emit({ kind: 'ext', name: 'mcp-ui', data: { resource: { uri: 'ui://approval/1' } } });
    });
    await act(() => result.current.send());
    expect(deliver).not.toHaveBeenCalled();
    expect(result.current.queuedPrompt).toBe('also fix the footer');
    expect(transport.stoppedRunIds).toEqual([]);
    expect(result.current.conversation.messages.at(-1)?.events?.some(event => event.kind === 'tool_result')).toBe(false);
    await act(async () => { transport.emit({ kind: 'status', label: 'tool_progress', code: 'tool_progress', data: { elapsedSeconds: 3 } }); });
    expect(deliver).not.toHaveBeenCalled();
    await act(async () => { transport.emit({ kind: 'tool_result', toolUseId: 'pending', content: '{"saved":true}', isError: false }); });
    await waitFor(() => expect(deliver).toHaveBeenCalledWith({ runId: 'run-1', text: 'also fix the footer' }));
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(transport.calls).toHaveLength(1);
    expect(transport.stoppedRunIds).toEqual([]);
  });

  it('retains the draft as queued until consumed, and leaves the live run going', async () => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'delivered');
    const { result, transport } = await startStreamingRun(deliver);

    await act(() => result.current.send());

    expect(deliver).toHaveBeenCalledWith({ runId: 'run-1', text: 'also fix the footer' });
    expect(result.current.composer.draft).toBe('');
    expect(result.current.queuedPrompt).toBe('also fix the footer');
    expect(transport.stoppedRunIds).toEqual([]);
    expect(transport.calls).toHaveLength(1);
    expect(result.current.conversation.isStreaming).toBe(true);
  });

  it('unsupported_delivery_queues_without_cancelling_run', async () => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'unsupported');
    const { result, transport } = await startStreamingRun(deliver);

    await act(() => result.current.send());

    expect(transport.stoppedRunIds).toEqual([]);
    expect(result.current.queuedPrompt).toBe('also fix the footer');
    expect(transport.calls).toHaveLength(1);
    await act(async () => { transport.finish(); });
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('also fix the footer');
  });

  it('sends the text next, without stopping the run, when the run is already ending', async () => {
    for (const outcome of ['not-running'] as const) {
      const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => outcome);
      const { result, transport, unmount } = await startStreamingRun(deliver);

      await act(() => result.current.send());

      expect(transport.stoppedRunIds).toEqual([]);
      expect(result.current.queuedPrompt).toBe('also fix the footer');
      expect(result.current.composer.draft).toBe('');
      unmount();
    }
  });

  it('keeps a failed delivery in the draft without stopping or queueing a new run', async () => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => { throw new Error('POST /runs/run-1/messages offline'); });
    const { result, transport } = await startStreamingRun(deliver);

    await act(() => result.current.send());

    expect(result.current.queuedPrompt).toBeNull();
    expect(result.current.composer.draft).toBe('also fix the footer');
    expect(result.current.typedAnswerNotice).toBe('failed');
    expect(transport.calls).toHaveLength(1);
    expect(transport.stoppedRunIds).toEqual([]);
  });

  it('ignores a mid-run delivery that settles after reset: nothing is queued for the fresh pane', async () => {
    let release!: (outcome: MidRunMessageDelivery) => void;
    const deliver = vi.fn(() => new Promise<MidRunMessageDelivery>((resolve) => { release = resolve; }));
    const { result, transport } = await startStreamingRun(deliver);
    let sending!: Promise<void>;
    act(() => { sending = result.current.send(); });
    act(() => result.current.reset());
    await act(async () => { release('not-running'); await sending; });

    expect(result.current.queuedPrompt).toBeNull();
    expect(transport.calls).toHaveLength(1);
  });

  it('steers both messages sent while a screenshot uploads into the run once the upload lands', async () => {
    const image = { path: 'attachment:uploaded', name: 'paste.png', kind: 'image' as const };
    let complete!: (attachments: typeof image[]) => void;
    const uploadAttachments = vi.fn(() => new Promise<typeof image[]>(resolve => { complete = resolve; }));
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'delivered');
    const { result } = await startStreamingRun(deliver, { uploadAttachments });
    let upload!: Promise<void>;
    act(() => { upload = result.current.addAttachments([new File(['pixels'], 'paste.png', { type: 'image/png' })]); });
    await act(() => result.current.send());
    act(() => result.current.composer.setDraft('and the header'));
    await act(() => result.current.send());
    expect(result.current.queuedPrompt).toBe('also fix the footer\n\nand the header');
    await act(async () => { complete([image]); await upload; });

    await waitFor(() => expect(deliver).toHaveBeenCalledWith({
      runId: 'run-1', text: 'also fix the footer\n\nand the header', attachments: [image],
    }));
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('keeps the old queue-behind-the-run behavior when the host gives no delivery', async () => {
    const { result, transport } = await startStreamingRun(undefined);

    await act(() => result.current.send());

    expect(result.current.queuedPrompt).toBe('also fix the footer');
    expect(transport.stoppedRunIds).toEqual([]);
  });

  // Owner, 2026-10-10: two messages sent while a run streams, neither taken mid-run, left only the
  // second — the one queue slot was overwritten. Both must reach the agent as the next turn.
  it('keeps BOTH messages sent while a run streams when neither goes into the run, and sends both next', async () => {
    for (const deliver of [vi.fn(async (): Promise<MidRunMessageDelivery> => 'not-running'), undefined]) {
      const { result, transport, unmount } = await startStreamingRun(deliver);

      await act(() => result.current.send());
      act(() => result.current.composer.setDraft('and save some context'));
      await act(() => result.current.send());

      expect(result.current.queuedPrompt).toBe('also fix the footer\n\nand save some context');
      await act(async () => {
        transport.finish();
      });
      await waitFor(() => expect(transport.calls).toHaveLength(2));
      expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('also fix the footer\n\nand save some context');
      expect(result.current.queuedPrompt).toBeNull();
      unmount();
    }
  });

  it('delivers the whole turn with its screenshot into the running agent', async () => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'delivered');
    const { result } = await startStreamingRun(deliver);
    const image = { path: 'attachment:1', name: 'a.png', kind: 'image' as const };
    act(() => result.current.composer.addAttachment(image));

    await act(() => result.current.send());

    expect(deliver).toHaveBeenCalledWith({ runId: 'run-1', text: 'also fix the footer', attachments: [image] });
    expect(result.current.queuedPrompt).toBe('also fix the footer');
    expect(result.current.composer.attachments).toEqual([]);
  });

  it.each([false, true])('waits for an uploading screenshot before sending mid-run (image only: %s)', async (imageOnly) => {
    const image = { path: 'attachment:uploaded', name: 'paste.png', kind: 'image' as const };
    let complete!: (attachments: typeof image[]) => void;
    const uploadAttachments = vi.fn(() => new Promise<typeof image[]>(resolve => { complete = resolve; }));
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'delivered');
    const { result, transport } = await startStreamingRun(deliver, { uploadAttachments });
    let upload!: Promise<void>;
    act(() => {
      if (imageOnly) result.current.composer.setDraft('');
      upload = result.current.addAttachments([new File(['pixels'], 'paste.png', { type: 'image/png' })]);
    });

    await act(() => result.current.send());
    expect(deliver).not.toHaveBeenCalled();
    expect(result.current.queuedPrompt).toBe(imageOnly ? 'Review the attached file(s).' : 'also fix the footer');
    act(() => result.current.composer.setDraft('a later, unsent draft'));
    await act(async () => { complete([image]); await upload; });

    await waitFor(() => expect(deliver).toHaveBeenCalledWith({
      runId: 'run-1', text: imageOnly ? 'Review the attached file(s).' : 'also fix the footer', attachments: [image],
    }));
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(transport.calls).toHaveLength(1);
    expect(result.current.composer.attachments).toEqual([]);
    expect(result.current.composer.draft).toBe('a later, unsent draft');
  });

  it('keeps the upload batch when a file starts uploading while a screenshot turn is being delivered', async () => {
    const image = { path: 'attachment:1', name: 'a.png', kind: 'image' as const };
    const batchIds: (string | undefined)[] = [];
    const uploads: (() => void)[] = [];
    const uploadAttachments = vi.fn((files: File[], options?: { batchId?: string }) => {
      batchIds.push(options?.batchId);
      const uploaded = files.map(file => ({ path: `attachment:${file.name}`, name: file.name, kind: 'file' as const }));
      return new Promise<typeof uploaded>(resolve => { uploads.push(() => resolve(uploaded)); });
    });
    let release!: (outcome: MidRunMessageDelivery) => void;
    const deliver = vi.fn(() => new Promise<MidRunMessageDelivery>((resolve) => { release = resolve; }));
    const { result } = await startStreamingRun(deliver, { uploadAttachments });
    act(() => result.current.composer.addAttachment(image));
    let sending!: Promise<void>;
    act(() => { sending = result.current.send(); });
    let upload!: Promise<void>;
    act(() => { upload = result.current.addAttachments([new File(['b'], 'b.txt')]); });
    await act(async () => { release('delivered'); await sending; });
    await act(async () => { uploads[0]?.(); await upload; });
    act(() => { void result.current.addAttachments([new File(['c'], 'c.txt')]); });

    expect(batchIds).toHaveLength(2);
    expect(batchIds[1]).toBe(batchIds[0]);
  });

  it('sends an upload-waiting turn as the next turn when the run ends before the upload lands', async () => {
    const image = { path: 'attachment:uploaded', name: 'paste.png', kind: 'image' as const };
    let complete!: (attachments: typeof image[]) => void;
    const uploadAttachments = vi.fn(() => new Promise<typeof image[]>(resolve => { complete = resolve; }));
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'delivered');
    const { result, transport } = await startStreamingRun(deliver, { uploadAttachments });
    let upload!: Promise<void>;
    act(() => { upload = result.current.addAttachments([new File(['pixels'], 'paste.png', { type: 'image/png' })]); });
    await act(() => result.current.send());
    await act(async () => { transport.finish(); });
    await act(async () => { complete([image]); await upload; });

    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(deliver).not.toHaveBeenCalled();
    expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('also fix the footer');
    expect(transport.calls[1]?.input.attachments).toEqual([image]);
  });

  it('queues the whole attachment turn until the reply ends when live images are unsupported', async () => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'unsupported');
    const { result, transport } = await startStreamingRun(deliver);
    const image = { path: 'attachment:1', name: 'a.png', kind: 'image' as const };
    act(() => result.current.composer.addAttachment(image));
    await act(() => result.current.send());

    expect(deliver).toHaveBeenCalledWith({ runId: 'run-1', text: 'also fix the footer', attachments: [image] });
    expect(transport.stoppedRunIds).toEqual([]);
    expect(result.current.queuedPrompt).toBe('also fix the footer');
    await act(async () => { transport.finish(); });
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]?.input).toMatchObject({ attachments: [image] });
    expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('also fix the footer');
  });

  it('keeps a queued screenshot with its original text when another message is submitted', async () => {
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'unsupported');
    const { result, transport } = await startStreamingRun(deliver);
    const image = { path: 'attachment:1', name: 'a.png', kind: 'image' as const };
    act(() => result.current.composer.addAttachment(image));
    await act(() => result.current.send());
    act(() => result.current.composer.setDraft('and check its header'));
    await act(() => result.current.send());
    expect(deliver).toHaveBeenCalledTimes(1);
    await act(async () => { transport.finish(); });
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]?.input.attachments).toEqual([image]);
    expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('also fix the footer\n\nand check its header');
  });

  it('holds the message when an upload fails rather than steering text without the image', async () => {
    let reject!: (error: Error) => void;
    const uploadAttachments = () => new Promise<never>((_resolve, fail) => { reject = fail; });
    const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'delivered');
    const { result, transport } = await startStreamingRun(deliver, { uploadAttachments });
    let upload!: Promise<void>;
    act(() => { upload = result.current.addAttachments([new File(['pixels'], 'paste.png')]); });
    await act(() => result.current.send());
    await act(async () => { reject(new Error('upload failed')); await upload; });
    await act(async () => { transport.finish(); });
    expect(deliver).not.toHaveBeenCalled();
    expect(transport.calls).toHaveLength(1);
    expect(result.current.queuedPrompt).toBe('also fix the footer');
    expect(result.current.attachmentError?.message).toBe('upload failed');
  });
});


describe('accepted queue recall', () => {
  it.each(['flush', 'cancel'] as const)('records each merged input at acceptance and never again on %s', async (ending) => {
    let saved: readonly string[] = [];
    const storage = { read: vi.fn(async () => saved), write: vi.fn(async ({ entries }: { entries: readonly string[] }) => { saved = [...entries]; }) };
    const { result, transport, unmount } = await startStreamingRun(undefined, { composerHistoryStorage: storage });
    await act(() => result.current.send());
    act(() => result.current.composer.setDraft('and check the header'));
    await act(() => result.current.send());
    await waitFor(() => expect(saved).toEqual(['first turn', 'also fix the footer', 'and check the header']));
    if (ending === 'cancel') act(() => result.current.cancelQueued());
    act(() => transport.finish());
    await waitFor(() => expect(transport.calls).toHaveLength(ending === 'flush' ? 2 : 1));
    expect(saved).toEqual(['first turn', 'also fix the footer', 'and check the header']);
    if (ending === 'flush') expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('also fix the footer\n\nand check the header');
    act(() => { result.current.composer.history?.navigate({ key: 'ArrowUp', text: '', selectionStart: 0, selectionEnd: 0 }); });
    expect(result.current.composer.draft).toBe('and check the header');
    unmount();
    const previousWrites = storage.write.mock.calls.length;
    const restored = renderHook(() => useChatPane({ transport: createFakeChatTransport(), agents, composerHistoryStorage: storage }));
    await waitFor(() => expect(storage.write.mock.calls.length).toBeGreaterThan(previousWrites));
    act(() => { restored.result.current.composer.history?.navigate({ key: 'ArrowUp', text: '', selectionStart: 0, selectionEnd: 0 }); });
    expect(restored.result.current.composer.draft).toBe('and check the header');
    restored.unmount();
  });

  it('keeps an explicit failed steering result out of history and retains staged attachments', async () => {
    let saved: readonly string[] = [];
    const storage = { read: vi.fn(async () => saved), write: vi.fn(async ({ entries }: { entries: readonly string[] }) => { saved = [...entries]; }) };
    const { result, transport } = await startStreamingRun(async () => 'failed', { composerHistoryStorage: storage });
    const image = { path: 'attachment:failed', name: 'retry.png', kind: 'image' as const };
    act(() => result.current.composer.addAttachment(image));
    await act(() => result.current.send());
    expect(result.current.composer.draft).toBe('also fix the footer');
    expect(result.current.composer.attachments).toEqual([image]);
    expect(result.current.queuedPrompt).toBeNull();
    expect(saved).toEqual(['first turn']);
    expect(transport.calls).toHaveLength(1);
  });
});


it('does not requeue staged attachments on another Enter after history updates', async () => {
  const { result, transport } = await startStreamingRun(undefined);
  act(() => {
    result.current.composer.setDraft('');
    result.current.composer.addAttachment({ path: 'attachment:once', name: 'once.png', kind: 'image' });
  });
  await act(() => result.current.send());
  await act(() => result.current.send());
  expect(result.current.queuedPrompt).toBe('Review the attached file(s).');
  act(() => transport.finish());
  await waitFor(() => expect(transport.calls).toHaveLength(2));
  expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('Review the attached file(s).');
  expect(transport.calls[1]?.input.attachments).toHaveLength(1);
});

// MOVE: A queued upload must retain its input identity across later submissions and cancellation.
describe('queued attachment ownership', () => {
  it('captures each message’s attachments in send order and leaves a later unsent file in the composer', async () => {
    const { result, transport } = await startStreamingRun(undefined);
    const first = { path: 'attachment:first', name: 'first.txt', kind: 'file' as const };
    const second = { path: 'attachment:second', name: 'second.png', kind: 'image' as const };
    const unsent = { path: 'attachment:unsent', name: 'unsent.txt', kind: 'file' as const };
    act(() => result.current.composer.addAttachment(first));
    await act(() => result.current.send());
    act(() => { result.current.composer.setDraft('second message'); result.current.composer.addAttachment(second); });
    await act(() => result.current.send());
    expect(result.current.queuedMessages.map(input => input.attachments)).toEqual([[first], [second]]);
    expect(result.current.composer.attachments).toEqual([]);
    act(() => { result.current.composer.setDraft('not submitted'); result.current.composer.addAttachment(unsent); });
    act(() => transport.finish());
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]!.input.attachments).toEqual([first, second]);
    expect(transport.calls[1]!.input.history.at(-1)?.content).toBe('also fix the footer\n\nsecond message');
    expect(result.current.composer.attachments).toEqual([unsent]);
    expect(result.current.composer.draft).toBe('not submitted');
  });

  it('attaches late upload results to message 2 while message 3 and its composer remain separate', async () => {
    const image = { path: 'attachment:late', name: 'late.png', kind: 'image' as const };
    let complete!: (attachments: typeof image[]) => void;
    const { result, transport } = await startStreamingRun(undefined, {
      uploadAttachments: () => new Promise<typeof image[]>(resolve => { complete = resolve; }),
    });
    await act(() => result.current.send());
    let upload!: Promise<void>;
    act(() => { upload = result.current.addAttachments([new File(['pixels'], 'late.png')]); result.current.composer.setDraft('second message'); });
    await act(() => result.current.send());
    act(() => result.current.composer.setDraft('third message'));
    await act(() => result.current.send());
    act(() => transport.finish());
    expect(transport.calls).toHaveLength(1);
    await act(async () => { complete([image]); await upload; });
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]!.input.attachments).toEqual([image]);
    const receiptEvents = transport.calls[1]!.input.history.at(-1)!.events!;
    const receipts = receiptEvents.map(event => event.kind === 'ext' ? event.data : null);
    expect(receipts).toMatchObject([
      { text: 'also fix the footer', attachments: [] },
      { text: 'second message', attachments: [image] },
      { text: 'third message', attachments: [] },
    ]);
    expect(result.current.composer.attachments).toEqual([]);
  });

  it('discards both queued inputs and a late screenshot when conversations switch', async () => {
    const transport = createFakeChatTransport();
    const image = { path: 'attachment:old', name: 'old.png', kind: 'image' as const };
    let complete!: (attachments: typeof image[]) => void;
    const uploadAttachments = () => new Promise<typeof image[]>(resolve => { complete = resolve; });
    const { result, rerender } = renderHook(({ conversationId }) => useChatPane({ transport, agents,
      initialDraft: 'first turn', conversationId, uploadAttachments }), { initialProps: { conversationId: 'queue-old' } });
    await act(() => result.current.send());
    act(() => result.current.composer.setDraft('old message one'));
    await act(() => result.current.send());
    let upload!: Promise<void>;
    act(() => { upload = result.current.addAttachments([new File(['pixels'], 'old.png')]); result.current.composer.setDraft('old message two'); });
    await act(() => result.current.send());
    expect(result.current.queuedMessages.map(input => input.text)).toEqual(['old message one', 'old message two']);
    rerender({ conversationId: 'queue-new' });
    await act(async () => { complete([image]); await upload; transport.finish(); });
    expect(result.current.queuedMessages).toEqual([]);
    expect(result.current.composer.attachments).toEqual([]);
    expect(result.current.isUploadingAttachments).toBe(false);
    expect(transport.calls).toHaveLength(1);
  });

  it('canceling an uploading input leaves the other message intact and rejects late pixels', async () => {
    const image = { path: 'attachment:canceled', name: 'cancel.png', kind: 'image' as const };
    let complete!: (attachments: typeof image[]) => void;
    const { result, transport } = await startStreamingRun(undefined, {
      uploadAttachments: () => new Promise<typeof image[]>(resolve => { complete = resolve; }),
    });
    await act(() => result.current.send());
    let upload!: Promise<void>;
    act(() => { upload = result.current.addAttachments([new File(['pixels'], 'cancel.png')]); result.current.composer.setDraft('cancel this screenshot'); });
    await act(() => result.current.send());
    act(() => result.current.cancelQueuedMessage({ id: result.current.queuedMessages[1]!.id }));
    await act(async () => { complete([image]); await upload; });
    expect(result.current.queuedMessages.map(input => input.text)).toEqual(['also fix the footer']);
    expect(result.current.composer.attachments).toEqual([]);
    act(() => transport.finish());
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]!.input.history.at(-1)?.content).toBe('also fix the footer');
    expect(transport.calls[1]!.input.attachments).toBeUndefined();
  });

  it('restores a queued screenshot with its text when starting the flushed run is rejected', async () => {
    const { result, transport } = await startStreamingRun(undefined);
    const image = { path: 'attachment:retry', name: 'retry.png', kind: 'image' as const };
    act(() => result.current.composer.addAttachment(image));
    await act(() => result.current.send());
    transport.startRun = async () => { throw new Error('offline'); };
    act(() => transport.finish());
    await waitFor(() => expect(result.current.composer.draft).toBe('also fix the footer'));
    expect(result.current.composer.attachments).toEqual([image]);
    expect(result.current.queuedMessages).toEqual([]);
  });
});

it.each([false, true])('aggregates only the surviving queued redaction signals (cancel first: %s)', async cancelFirst => {
  const redactUserText = ({ text }: { text: string }, _options = {}) => {
    const count = text.match(/SECRET/g)?.length ?? 0;
    return { text: text.replaceAll('SECRET', '[token removed]'), secretRedacted: count > 0, count };
  };
  const { result, transport } = await startStreamingRun(undefined, { redactUserText });
  act(() => result.current.composer.setDraft('one SECRET'));
  await act(() => result.current.send());
  act(() => result.current.composer.setDraft('two SECRET SECRET'));
  await act(() => result.current.send());
  expect(result.current.queuedMessages.map(input => input.secretRedaction?.count)).toEqual([1, 2]);
  if (cancelFirst) act(() => result.current.cancelQueuedMessage({ id: result.current.queuedMessages[0]!.id }));
  act(() => transport.finish());
  await waitFor(() => expect(transport.calls).toHaveLength(2));
  expect(transport.calls[1]!.input.history.at(-1)?.secretRedaction).toEqual({ secretRedacted: true, count: cancelFirst ? 2 : 3 });
  expect(transport.calls[1]!.input.history.at(-1)?.content).toBe(cancelFirst
    ? 'two [token removed] [token removed]' : 'one [token removed]\n\ntwo [token removed] [token removed]');
});


it('exposes queued state immediately on acceptance and consumed state only after a wire receipt', async () => {
  const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => 'delivered');
  const { result, transport } = await startStreamingRun(deliver);
  await act(() => result.current.send());
  const inputs = () => projectAcceptedInputEvents({ events: result.current.conversation.messages.at(-1)?.events ?? [] })
    .flatMap(event => { const input = acceptedInputEvent({ event }); return input ? [input.data] : []; });
  expect(inputs()).toHaveLength(1);
  expect(inputs()[0]!.deliveryState).toBe('queued');
  await act(async () => { transport.emit({ kind: 'text', text: 'still working on the previous step' }); });
  expect(inputs()[0]!.deliveryState).toBe('queued');
  await act(async () => { transport.emit({ kind: 'ext', name: 'user_message', data: {
    id: 'wire', text: 'also fix the footer', deliveryState: 'consumed',
  } }); });
  expect(inputs()).toHaveLength(1);
  expect(inputs()[0]!.deliveryState).toBe('consumed');
  expect(result.current.queuedPrompt).toBeNull();
});

it('keep_until_consumed_matches_id_and_flushes_only_leftovers', async () => {
  let counter = 0;
  const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => ({ delivery: 'delivered', id: `wire-${++counter}` }));
  const { result, transport } = await startStreamingRun(deliver);
  await act(() => result.current.send());
  act(() => result.current.composer.setDraft('second message'));
  await act(() => result.current.send());
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(result.current.queuedPrompt).toBe('also fix the footer\n\nsecond message');
  await act(async () => { transport.emit({ kind: 'ext', name: 'user_message', data: {
    id: 'other', text: 'also fix the footer', deliveryState: 'consumed', via: 'tool-result',
  } }); });
  expect(result.current.queuedPrompt).toBe('also fix the footer\n\nsecond message');
  await act(async () => {
    transport.emit({ kind: 'ext', name: 'user_message', data: {
      id: 'wire-1', text: 'also fix the footer', deliveryState: 'consumed', via: 'tool-result',
    } });
    transport.finish(); // receipt and end in one React batch must not resend the first message
  });
  await waitFor(() => expect(transport.calls).toHaveLength(2));
  expect(transport.calls[1]!.input.history.at(-1)?.content).toBe('second message');
  expect(transport.stoppedRunIds).toEqual([]);
});

it('keeps_an_accepted_attachment_until_consumed_or_next_turn', async () => {
  const deliver = vi.fn(async (): Promise<MidRunMessageDelivery> => ({ delivery: 'delivered', id: 'with-image' }));
  const { result, transport } = await startStreamingRun(deliver);
  const image = { path: 'attachment:1', name: 'image.png', kind: 'image' as const };
  act(() => result.current.composer.addAttachment(image));
  await act(() => result.current.send());
  const queuedBubble = (result.current.conversation.messages.at(-1)?.events ?? []).flatMap(event => {
    const input = acceptedInputEvent({ event }); return input ? input.data.inputs ?? [input.data] : [];
  });
  expect(queuedBubble[0]!.attachments).toEqual([image]);
  await act(async () => { transport.finish(); });
  await waitFor(() => expect(transport.calls).toHaveLength(2));
  expect(transport.calls[1]!.input.history.at(-1)?.attachments).toEqual([image]);
});
