import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetComposerDraftCacheForTests } from '../../../../hooks/composer-draft-cache.js';
import {
  __resetAttachmentPreviewCacheForTests,
  getAttachmentPreviewSource,
} from '../../../../hooks/attachment-preview-cache.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import type { ChatPaneAgent } from '../../types.js';
import { useChatPane } from '../../hooks/useChatPane.hooks.js';

const agents: ChatPaneAgent[] = [
  { id: 'codex', name: 'Codex CLI', available: true },
  { id: 'gemini', name: 'Gemini CLI', available: true },
];

describe('useChatPane', () => {
  beforeEach(() => {
    __resetComposerDraftCacheForTests();
    __resetAttachmentPreviewCacheForTests();
  });

  it('threads conversationId into the composer so a draft round-trips a conversation switch', () => {
    // Reproduces the owner-reported bug: `useChatPane` used to call `useComposer` with only
    // `initialDraft`/`initialAgent` (never `conversationId`), so nothing survived a host remounting
    // `ChatPane` on switch (a conversation-keyed `key`).
    const transport = createFakeChatTransport();
    const first = renderHook(() => useChatPane({ transport, agents, conversationId: 'chat-1' }));
    act(() => first.result.current.composer.setDraft('remember to follow up with the vendor'));
    first.unmount();

    const other = renderHook(() => useChatPane({ transport, agents, conversationId: 'chat-2' }));
    expect(other.result.current.composer.draft).toBe('');
    other.unmount();

    const back = renderHook(() => useChatPane({ transport, agents, conversationId: 'chat-1' }));
    expect(back.result.current.composer.draft).toBe('remember to follow up with the vendor');
  });

  it('owns uncontrolled selection changes and ignores invalid sends', async () => {
    const transport = createFakeChatTransport();
    const onSelectionChange = vi.fn();
    const { result } = renderHook(() => useChatPane({
      transport,
      agents,
      onSelectionChange,
    }));

    await act(() => result.current.send());
    expect(transport.calls).toHaveLength(0);

    act(() => result.current.setSelection({ agentId: 'gemini' }));
    expect(result.current.selection).toEqual({ agentId: 'gemini' });
    expect(result.current.composer.agent).toEqual({ agentId: 'gemini' });
    expect(onSelectionChange).toHaveBeenCalledWith({ agentId: 'gemini' });
  });

  it('sends staged attachments with controlled selection and resets empty state', async () => {
    const transport = createFakeChatTransport();
    const onActivityChange = vi.fn();
    const { result } = renderHook(() => useChatPane({
      transport,
      agents,
      selection: { agentId: 'codex' },
      conversationId: null,
      initialDraft: 'Attached context',
      onActivityChange,
    }));

    act(() => result.current.composer.addAttachment({
      path: '/tmp/example.txt',
      name: 'example.txt',
      kind: 'file',
    }));
    await act(() => result.current.send());
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(transport.calls[0]?.input).toMatchObject({
      agentId: 'codex',
      conversationId: null,
      attachments: [{
        path: '/tmp/example.txt',
        name: 'example.txt',
        kind: 'file',
      }],
    });
    expect(transport.calls[0]?.input).not.toHaveProperty('context');
    expect(onActivityChange).toHaveBeenCalledWith('queued');

    act(() => result.current.reset());
    expect(result.current.conversation.messages).toEqual([]);
    expect(result.current.composer.draft).toBe('');
  });

  it('reports the live message list via onMessagesChange as the conversation grows', async () => {
    const transport = createFakeChatTransport();
    const onMessagesChange = vi.fn();
    const { result } = renderHook(() => useChatPane({
      transport,
      agents,
      selection: { agentId: 'codex' },
      initialDraft: 'Hello there',
      onMessagesChange,
    }));

    expect(onMessagesChange).toHaveBeenCalledWith([]);

    await act(() => result.current.send());
    await waitFor(() => expect(transport.calls).toHaveLength(1));

    const lastCallMessages = onMessagesChange.mock.calls.at(-1)?.[0];
    expect(lastCallMessages).toHaveLength(2);
    expect(lastCallMessages).toContainEqual(expect.objectContaining({ role: 'user', content: 'Hello there' }));
    expect(result.current.conversation.messages).toBe(lastCallMessages);
  });

  it('normalizes attachment failures and accepts controlled working-directory state', async () => {
    const transport = createFakeChatTransport();
    const uploadAttachments = vi.fn(async () => {
      throw 'upload bridge failed';
    });
    const { result } = renderHook(() => useChatPane({
      transport,
      agents,
      workingDirectory: '/work/controlled',
      uploadAttachments,
    }));

    await act(() => result.current.addAttachments([]));
    expect(uploadAttachments).not.toHaveBeenCalled();
    await act(() => result.current.addAttachments([
      new File(['content'], 'notes.txt', { type: 'text/plain' }),
    ]));
    expect(result.current.attachmentError?.message).toBe('upload bridge failed');
    expect(result.current.workingDirectory).toBe('/work/controlled');
  });

  it('populates the attachment preview cache through the real attach path (drag-drop/file-picker), not just when the cache function is called directly', async () => {
    // Reproduces the owner-reported bug: `AttachmentPreviewModal` always says "a preview is not
    // available" because ChatPane's actual attach path (this hook's own `addAttachments`, which
    // both drag-drop and the file picker call — see `ChatPane.tsx`'s `resolveDropTargetProps`/
    // `resolveComposerAttachmentPicker`) never wrote to `attachment-preview-cache.ts`. Only
    // `useComposer.ts`'s OWN `addAttachments` did that, and nothing in production calls it. A test
    // that called `cacheAttachmentPreviewSource` directly would pass whether or not this hook wires
    // it up at all, so this asserts through `pane.addAttachments` instead — the same function
    // `ChatPane` hands to both real entry points.
    const transport = createFakeChatTransport();
    const uploadAttachments = vi.fn(async (files: File[]) => files.map((file, index) => ({
      path: `attachment:${index}`,
      name: file.name,
      kind: 'file' as const,
    })));
    const { result } = renderHook(() => useChatPane({ transport, agents, uploadAttachments }));

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await act(() => result.current.addAttachments([file]));

    expect(getAttachmentPreviewSource('attachment:0')).toBe(file);
  });

  it('blocks send while a directory is pending/invalid and supports attachment-only send', async () => {
    let resolveExists!: (exists: boolean) => void;
    const exists = new Promise<boolean>((resolve) => {
      resolveExists = resolve;
    });
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useChatPane({
      transport,
      agents,
      initialWorkingDirectory: '/work/pending',
      workingDirectoryAccess: {
        pickWorkingDirectory: async () => null,
        recentDirectories: async () => [],
        directoryExists: async () => exists,
      },
    }));
    act(() => result.current.composer.addAttachment({
      path: '/tmp/example.txt',
      name: 'example.txt',
      kind: 'file',
    }));

    expect(result.current.workingDirectoryPending).toBe(true);
    expect(result.current.canSend).toBe(false);
    await act(() => result.current.send());
    expect(transport.calls).toHaveLength(0);

    await act(async () => resolveExists(true));
    expect(result.current.canSend).toBe(true);
    await act(() => result.current.send());
    expect(transport.calls[0]?.input.history.at(-1)?.content)
      .toBe('Review the attached file(s).');
  });

  it('tracks overlapping uploads and ignores late results after reset or unmount', async () => {
    const pending: Array<{
      resolve: (attachments: Array<{ path: string; name: string; kind: 'file' }>) => void;
      signal: AbortSignal;
      batchId: string;
    }> = [];
    const uploadAttachments = vi.fn((
      _files: File[],
      options?: { signal: AbortSignal; batchId: string },
    ) => new Promise<Array<{ path: string; name: string; kind: 'file' }>>((resolve) => {
      pending.push({
        resolve,
        signal: options!.signal,
        batchId: options!.batchId,
      });
    }));
    const transport = createFakeChatTransport();
    const { result, unmount } = renderHook(() => useChatPane({
      transport,
      agents,
      uploadAttachments,
    }));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.addAttachments([new File(['a'], 'a.txt')]);
      second = result.current.addAttachments([new File(['b'], 'b.txt')]);
    });
    expect(result.current.isUploadingAttachments).toBe(true);
    expect(result.current.canSend).toBe(false);
    expect(pending[0]?.batchId).toBe(pending[1]?.batchId);

    await act(async () => {
      pending[0]?.resolve([{ path: '/tmp/a', name: 'a.txt', kind: 'file' }]);
      await first;
    });
    expect(result.current.isUploadingAttachments).toBe(true);
    expect(result.current.composer.attachments).toHaveLength(1);

    act(() => result.current.reset());
    expect(pending[1]?.signal.aborted).toBe(true);
    await act(async () => {
      pending[1]?.resolve([{ path: '/tmp/b', name: 'b.txt', kind: 'file' }]);
      await second;
    });
    expect(result.current.isUploadingAttachments).toBe(false);
    expect(result.current.composer.attachments).toEqual([]);

    let third!: Promise<void>;
    act(() => {
      third = result.current.addAttachments([new File(['c'], 'c.txt')]);
    });
    const thirdSignal = pending[2]!.signal;
    unmount();
    expect(thirdSignal.aborted).toBe(true);
    pending[2]?.resolve([{ path: '/tmp/c', name: 'c.txt', kind: 'file' }]);
    await third;
  });

  it('creates a fallback attachment batch id when randomUUID is unavailable', () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {},
    });
    try {
      const { result } = renderHook(() => useChatPane({
        transport: createFakeChatTransport(),
        agents,
      }));
      expect(result.current.isUploadingAttachments).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      });
    }
  });

  it('rejects an agent-driven send for an empty or whitespace-only prompt', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useChatPane({ transport, agents }));

    await expect(result.current.sendPrompt('   ')).rejects.toThrow('cannot send: the prompt is empty');
    expect(transport.calls).toHaveLength(0);
  });

  it('queues an Enter sent while streaming, clearing only the draft and keeping staged attachments', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useChatPane({
      transport,
      agents,
      selection: { agentId: 'codex' },
      initialDraft: 'first turn',
    }));

    await act(() => result.current.send());
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(result.current.conversation.isStreaming).toBe(true);

    act(() => {
      result.current.composer.setDraft('second turn');
      result.current.composer.addAttachment({ path: '/tmp/b.txt', name: 'b.txt', kind: 'file' });
    });
    await act(() => result.current.send());

    expect(result.current.queuedPrompt).toBe('second turn');
    expect(result.current.composer.draft).toBe('');
    // `send()` uses `composer.setDraft('')`, NOT `composer.reset()` — a reset would also wipe the
    // attachment this queued turn still needs when it finally goes out.
    expect(result.current.composer.attachments).toEqual([{ path: '/tmp/b.txt', name: 'b.txt', kind: 'file' }]);
    // Nothing was sent yet — the second turn is only queued while the first is still streaming.
    expect(transport.calls).toHaveLength(1);
  });

  it('flushes the queued prompt exactly once when the run finishes, and never double-sends on extra renders', async () => {
    const transport = createFakeChatTransport();
    const { result, rerender } = renderHook(
      (props: { title?: string }) => useChatPane({ transport, agents, selection: { agentId: 'codex' }, initialDraft: 'first turn', ...props }),
      { initialProps: {} },
    );

    await act(() => result.current.send());
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    act(() => result.current.composer.setDraft('second turn'));
    await act(() => result.current.send());
    expect(result.current.queuedPrompt).toBe('second turn');

    await act(async () => {
      transport.finish();
    });

    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('second turn');
    expect(result.current.queuedPrompt).toBeNull();

    // Force a few extra re-renders after the flush — the queue slot was cleared before the send
    // was awaited, so a stray re-render must not resend the same prompt a second time.
    rerender({ title: 'a' });
    rerender({ title: 'b' });
    await waitFor(() => expect(result.current.conversation.isStreaming).toBe(true));
    expect(transport.calls).toHaveLength(2);
  });

  it('does NOT flush a queued prompt merely because streaming ended — an unrelated blocker (uploads-pending) still holds it', async () => {
    // Pins the ordering trap documented on `isChatPaneQueueableBlocker`: `findChatPaneSendBlocker`
    // reports 'streaming' ahead of 'uploads-pending', so a queueing decision made off 'streaming'
    // alone does not prove uploads have cleared. The flush effect must wait for a fully-null
    // blocker, not merely for `isStreaming` to flip false.
    let resolveUpload!: (attachments: Array<{ path: string; name: string; kind: 'file' }>) => void;
    const uploadAttachments = vi.fn(() => new Promise<Array<{ path: string; name: string; kind: 'file' }>>((resolve) => {
      resolveUpload = resolve;
    }));
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useChatPane({
      transport,
      agents,
      selection: { agentId: 'codex' },
      initialDraft: 'first turn',
      uploadAttachments,
    }));

    await act(() => result.current.send());
    await waitFor(() => expect(transport.calls).toHaveLength(1));

    // Start an upload that never resolves on its own, then queue a second turn behind streaming.
    act(() => {
      void result.current.addAttachments([new File(['b'], 'b.txt')]);
    });
    expect(result.current.isUploadingAttachments).toBe(true);
    act(() => result.current.composer.setDraft('second turn'));
    await act(() => result.current.send());
    expect(result.current.queuedPrompt).toBe('second turn');

    // End the run. Streaming clears, but the upload is still in flight, so `sendBlocker` becomes
    // 'uploads-pending', not null — the queued prompt must stay put.
    await act(async () => {
      transport.finish();
    });
    expect(result.current.conversation.isStreaming).toBe(false);
    expect(result.current.queuedPrompt).toBe('second turn');
    expect(transport.calls).toHaveLength(1);

    // Only once the upload itself resolves does the blocker go fully null and the flush fire.
    await act(async () => {
      resolveUpload([{ path: '/tmp/b', name: 'b.txt', kind: 'file' }]);
    });
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('second turn');
    expect(result.current.queuedPrompt).toBeNull();
  });

  it('interruptSend cancels the in-flight run and queues the draft — held behind any remaining blocker exactly like a plain queued send', async () => {
    let resolveUpload!: (attachments: Array<{ path: string; name: string; kind: 'file' }>) => void;
    const uploadAttachments = vi.fn(() => new Promise<Array<{ path: string; name: string; kind: 'file' }>>((resolve) => {
      resolveUpload = resolve;
    }));
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useChatPane({
      transport,
      agents,
      selection: { agentId: 'codex' },
      initialDraft: 'first turn',
      uploadAttachments,
    }));

    await act(() => result.current.send());
    await waitFor(() => expect(transport.calls).toHaveLength(1));

    // Keep an upload in flight so the interrupt's own queued turn cannot flush immediately —
    // this is what proves interruptSend goes through the SAME queue path as a plain queued
    // `send()`, rather than some separate cancel-then-send-directly branch.
    act(() => {
      void result.current.addAttachments([new File(['b'], 'b.txt')]);
    });
    act(() => result.current.composer.setDraft('next turn'));
    act(() => result.current.interruptSend());

    expect(transport.stoppedRunIds).toContain('run-1');
    expect(result.current.conversation.isStreaming).toBe(false);
    expect(result.current.queuedPrompt).toBe('next turn');
    expect(result.current.composer.draft).toBe('');
    expect(transport.calls).toHaveLength(1);

    await act(async () => {
      resolveUpload([{ path: '/tmp/b', name: 'b.txt', kind: 'file' }]);
    });
    await waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[1]?.input.history.at(-1)?.content).toBe('next turn');
  });

  it('cancelQueued drops the queued prompt without ever sending it', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useChatPane({
      transport,
      agents,
      selection: { agentId: 'codex' },
      initialDraft: 'first turn',
    }));

    await act(() => result.current.send());
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    act(() => result.current.composer.setDraft('never sent'));
    await act(() => result.current.send());
    expect(result.current.queuedPrompt).toBe('never sent');

    act(() => result.current.cancelQueued());
    expect(result.current.queuedPrompt).toBeNull();

    await act(async () => {
      transport.finish();
    });
    // Give the flush effect a chance to run — it must find nothing queued.
    await waitFor(() => expect(result.current.conversation.isStreaming).toBe(false));
    expect(transport.calls).toHaveLength(1);
  });

  it('drops a queued prompt on reset instead of flushing it into the freshly reset conversation', async () => {
    // Reproduces the owner-reported bug: `reset()` never cleared `queuedPrompt`, so a prompt
    // queued behind a streaming run survived the reset. `conversation.cancel()` (inside `reset`)
    // clears the 'streaming' blocker synchronously, so the flush effect fired right after,
    // silently sending the stale queued turn into the just-reset conversation.
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useChatPane({
      transport,
      agents,
      selection: { agentId: 'codex' },
      initialDraft: 'first turn',
    }));

    await act(() => result.current.send());
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    act(() => result.current.composer.setDraft('second turn'));
    await act(() => result.current.send());
    expect(result.current.queuedPrompt).toBe('second turn');

    act(() => result.current.reset());

    expect(result.current.queuedPrompt).toBeNull();
    expect(result.current.conversation.messages).toEqual([]);
    // Give any (buggy) flush effect a full macrotask to fire — `startRun` and its state updates
    // settle asynchronously, so asserting immediately after `reset()` would pass even on the
    // unfixed code for the wrong reason (the send hadn't landed in `transport.calls` yet).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitFor(() => expect(result.current.conversation.isStreaming).toBe(false));
    expect(transport.calls).toHaveLength(1);
  });

  it('drops a queued prompt instead of misrouting it into a conversation switched to mid-flight', async () => {
    // Reproduces the owner-reported bug: `queuedPrompt` was not scoped to the conversation it was
    // queued against. A turn queued behind a streaming run in conversation A stayed queued (the
    // underlying run instance keeps streaming regardless of the `conversationId` prop), then flushed
    // into conversation B — the conversation the caller had since switched to — once that run ended.
    const transport = createFakeChatTransport();
    const { result, rerender } = renderHook(
      (props: { conversationId: string }) => useChatPane({
        transport,
        agents,
        selection: { agentId: 'codex' },
        initialDraft: 'first turn',
        ...props,
      }),
      { initialProps: { conversationId: 'conv-a' } },
    );

    await act(() => result.current.send());
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(transport.calls[0]?.input.conversationId).toBe('conv-a');
    expect(result.current.conversation.isStreaming).toBe(true);

    act(() => result.current.composer.setDraft('second turn'));
    await act(() => result.current.send());
    expect(result.current.queuedPrompt).toBe('second turn');

    // Switch conversations WHILE the first run is still streaming — a same-instance ChatPane
    // moving between conversations without unmounting, e.g. a sidebar switch.
    rerender({ conversationId: 'conv-b' });
    expect(result.current.conversation.conversationId).toBe('conv-b');
    // The underlying run instance is unaffected by the conversationId prop, so it is still the
    // same in-flight run from conversation A.
    expect(result.current.conversation.isStreaming).toBe(true);

    await act(async () => {
      transport.finish();
    });
    await waitFor(() => expect(result.current.conversation.isStreaming).toBe(false));

    expect(result.current.queuedPrompt).toBeNull();
    expect(transport.calls).toHaveLength(1);
  });

  it('ignores a stale upload failure raised after a reset already started a fresh batch', async () => {
    const pending: Array<{
      resolve: (attachments: Array<{ path: string; name: string; kind: 'file' }>) => void;
      reject: (error: unknown) => void;
    }> = [];
    const uploadAttachments = vi.fn(() => new Promise<Array<{ path: string; name: string; kind: 'file' }>>(
      (resolve, reject) => {
        pending.push({ resolve, reject });
      },
    ));
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useChatPane({ transport, agents, uploadAttachments }));

    act(() => {
      void result.current.addAttachments([new File(['a'], 'a.txt')]);
    });

    act(() => result.current.reset());

    let second!: Promise<void>;
    act(() => {
      second = result.current.addAttachments([new File(['b'], 'b.txt')]);
    });
    await act(async () => {
      pending[1]?.resolve([{ path: '/tmp/b', name: 'b.txt', kind: 'file' }]);
      await second;
    });
    expect(result.current.composer.attachments).toEqual([{ path: '/tmp/b', name: 'b.txt', kind: 'file' }]);
    expect(result.current.attachmentError).toBeNull();

    await act(async () => {
      pending[0]?.reject(new Error('stale upload failed'));
    });
    expect(result.current.attachmentError).toBeNull();
    expect(result.current.composer.attachments).toEqual([{ path: '/tmp/b', name: 'b.txt', kind: 'file' }]);
  });
});
