import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetComposerDraftCacheForTests } from '../../../../hooks/composer-draft-cache.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import type { ChatPaneAgent, DeliverMidRunMessage, MidRunMessageDelivery } from '../../types.js';
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
    expect(result.current.queuedPrompt).toBeNull();
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
