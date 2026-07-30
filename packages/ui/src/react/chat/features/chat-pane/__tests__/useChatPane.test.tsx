import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createFakeChatTransport } from '../../../hooks/testing/fake-transport.js';
import type { ChatPaneAgent } from '../types.js';
import { useChatPane } from '../react/hooks/useChatPane.hooks.js';

const agents: ChatPaneAgent[] = [
  { id: 'codex', name: 'Codex CLI', available: true },
  { id: 'gemini', name: 'Gemini CLI', available: true },
];

describe('useChatPane', () => {
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
