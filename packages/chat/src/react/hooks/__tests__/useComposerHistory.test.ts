import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../core/messages.js';
import type { ComposerHistoryStoragePort } from '../../../core/composer-history.js';
import { useComposer } from '../useComposer.js';

function user(id: string, content: string): ChatMessage { return { id, role: 'user', content }; }
const up = { key: 'ArrowUp', text: 'working draft', selectionStart: 0, selectionEnd: 0 };

describe('composer history hook', () => {
  it('combines persisted recent prompts with current user text, excluding assistant and attachment-only turns', async () => {
    const write = vi.fn(async () => {});
    const storage: ComposerHistoryStoragePort = { read: async () => ['earlier chat'], write };
    const messages: ChatMessage[] = [user('a', 'sent here'), { id: 'b', role: 'assistant', content: 'answer' }, { ...user('c', ''), attachments: [{ path: '/file', name: 'file', kind: 'file' }] }];
    const { result } = renderHook(() => useComposer({ historyScope: 'alice', historyStorage: storage, historyMessages: messages, initialDraft: 'working draft' }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    act(() => { expect(result.current.history?.navigate(up)).toBe(true); });
    expect(result.current.draft).toBe('sent here');
    act(() => { result.current.history?.navigate({ ...up, text: result.current.draft }); });
    expect(result.current.draft).toBe('earlier chat');
    act(() => { result.current.history?.navigate({ ...up, key: 'Escape', text: result.current.draft }); });
    expect(result.current.draft).toBe('working draft');
  });

  it('preserves sends arriving during async hydration and serializes storage writes', async () => {
    let finishRead!: (entries: string[]) => void;
    const read = new Promise<string[]>((resolve) => { finishRead = resolve; });
    const mutableWrites: string[][] = [];
    const storage: ComposerHistoryStoragePort = {
      read: () => read,
      write: async ({ entries }) => { mutableWrites.push([...entries]); },
    };
    const { result, rerender } = renderHook(({ messages }: { messages: ChatMessage[] }) => useComposer({ historyScope: 'alice', historyStorage: storage, historyMessages: messages }), { initialProps: { messages: [] as ChatMessage[] } });
    rerender({ messages: [user('new', 'new send')] });
    await act(async () => { finishRead(['older']); await read; });
    await waitFor(() => expect(mutableWrites.at(-1)).toEqual(['older', 'new send']));
    act(() => { result.current.history?.navigate({ ...up, text: '' }); });
    expect(result.current.draft).toBe('new send');
    act(() => { result.current.history?.navigate({ ...up, text: result.current.draft }); });
    expect(result.current.draft).toBe('older');
  });

  it('queues a later write behind a slow earlier write so older prompts cannot overwrite it', async () => {
    let finishFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => { finishFirst = resolve; });
    const snapshots: string[][] = [];
    const storage: ComposerHistoryStoragePort = {
      read: async () => ['older'],
      write: async ({ entries }) => {
        snapshots.push([...entries]);
        if (snapshots.length === 1) await firstWrite;
      },
    };
    const { rerender } = renderHook(({ messages }: { messages: ChatMessage[] }) => useComposer({ historyStorage: storage, historyMessages: messages }), { initialProps: { messages: [] as ChatMessage[] } });
    await waitFor(() => expect(snapshots).toEqual([['older']]));
    rerender({ messages: [user('new', 'new send')] });
    await act(async () => { await Promise.resolve(); });
    expect(snapshots).toEqual([['older']]);
    await act(async () => { finishFirst(); await firstWrite; });
    await waitFor(() => expect(snapshots).toEqual([['older'], ['older', 'new send']]));
  });

  it('does not persist a recalled view over the original cached draft', async () => {
    const storage: ComposerHistoryStoragePort = { read: async () => [], write: async () => {} };
    const options = { conversationId: 'history-draft-contract', historyStorage: storage, historyMessages: [user('a', 'sent')], initialDraft: '  working draft  ' };
    const first = renderHook(() => useComposer(options));
    act(() => { first.result.current.setDraft('  working draft  '); });
    act(() => { first.result.current.history?.navigate(up); });
    expect(first.result.current.draft).toBe('sent');
    first.unmount();
    const second = renderHook(() => useComposer({ conversationId: options.conversationId, historyStorage: storage }));
    expect(second.result.current.draft).toBe('  working draft  ');
    act(() => { second.result.current.reset(); });
  });

  it('persists the first send when a new conversation adopts its server id', async () => {
    const write = vi.fn(async () => {});
    const storage: ComposerHistoryStoragePort = { read: async () => [], write };
    const { rerender } = renderHook(({ messages, conversationId }: { messages: ChatMessage[]; conversationId: string | null }) => useComposer({ historyStorage: storage, historyMessages: messages, conversationId }), { initialProps: { messages: [] as ChatMessage[], conversationId: null as string | null } });
    await waitFor(() => expect(write).toHaveBeenCalled());
    rerender({ messages: [user('first', 'first send')], conversationId: 'adopted' });
    await waitFor(() => expect(write).toHaveBeenLastCalledWith({ scope: 'default', entries: ['first send'] }, {}));
  });

  it('continues editing and recalling current turns when an injected port fails', async () => {
    const read = vi.fn(async () => { throw new Error('offline'); });
    const write = vi.fn(async () => { throw new Error('offline'); });
    const storage: ComposerHistoryStoragePort = { read, write };
    const { result } = renderHook(() => useComposer({ historyStorage: storage, historyMessages: [user('a', 'sent')] }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    act(() => { result.current.history?.navigate(up); });
    expect(result.current.draft).toBe('sent');
    act(() => { result.current.setDraft('edited'); });
    act(() => { result.current.history?.navigate({ ...up, key: 'Escape', text: 'edited' }); });
    expect(result.current.draft).toBe('edited');
  });
});
