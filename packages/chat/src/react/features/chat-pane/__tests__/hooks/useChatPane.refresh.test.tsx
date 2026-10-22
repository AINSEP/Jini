import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../../../core/index.js';
import type { UseConversationOptions } from '../../../../hooks/useConversation.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { useChatPane } from '../../hooks/useChatPane.hooks.js';

function message(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, createdAt: 1 };
}

function signal(loadMessages: () => Promise<ChatMessage[]>) {
  const refreshSignal = {
    loadMessages,
    visibility: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    focus: new EventTarget(),
  } satisfies NonNullable<UseConversationOptions['refreshSignal']>;
  return { refreshSignal, emit: async () => {
    refreshSignal.focus.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(500);
  } };
}

describe('passive conversation refresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces focus and becoming visible into one load after 500 ms and ignores hidden events', async () => {
    const load = vi.fn(async () => [message('saved', 'Visible update')]);
    const h = signal(load);
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useChatPane({ transport, agents: [], refreshSignal: h.refreshSignal }));
    h.refreshSignal.visibility.visibilityState = 'hidden';
    await act(() => h.emit());
    expect(load).toHaveBeenCalledTimes(0);
    h.refreshSignal.visibility.visibilityState = 'visible';
    h.refreshSignal.visibility.dispatchEvent(new Event('visibilitychange'));
    h.refreshSignal.focus.dispatchEvent(new Event('focus'));
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(load).toHaveBeenCalledTimes(0);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.conversation.messages).toEqual([message('saved', 'Visible update')]);
  });

  it('upserts repeated ids in place, keeps local messages, draft and scroll intent, and never follows a saved run', async () => {
    const transport = createFakeChatTransport();
    const remote: ChatMessage = { id: 'remote-run', role: 'assistant', content: 'Saved progress', createdAt: 3, runId: 'elsewhere', runStatus: 'running' };
    const load = vi.fn(async () => [message('first', 'Updated'), remote, message('first', 'Newest')]);
    const h = signal(load);
    const { result } = renderHook(() => useChatPane({
      transport, agents: [], conversationId: 'chat-a',
      initialMessages: [message('first', 'Old'), message('local', 'Keep me')], refreshSignal: h.refreshSignal,
    }));
    const composer = result.current.composer;
    act(() => {
      composer.setDraft('Unsent draft');
      result.current.conversation.suppressScroll();
    });
    await act(() => h.emit());
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.conversation.messages).toEqual([message('first', 'Newest'), message('local', 'Keep me'), remote]);
    expect(result.current.composer.draft).toBe('Unsent draft');
    expect(result.current.composer.setDraft).toBe(composer.setDraft);
    expect(result.current.conversation.scrollIntent).toBe(false);
    expect(result.current.conversation.isStreaming).toBe(false);
    expect(transport.reattachCalls).toEqual([]);
    expect(transport.calls).toEqual([]);
    await act(() => h.emit());
    expect(result.current.conversation.messages).toHaveLength(3);
  });

  it('does not load during an owned run, including its pending start request', async () => {
    const transport = createFakeChatTransport();
    let resolveStart!: (value: { runId: string }) => void;
    transport.startRun = () => new Promise(resolve => { resolveStart = resolve; });
    const load = vi.fn(async () => [message('saved', 'Must not load')]);
    const h = signal(load);
    const { result } = renderHook(() => useChatPane({ transport, agents: [], refreshSignal: h.refreshSignal }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.conversation.sendMessage('Local turn'); });
    await act(() => h.emit());
    expect(load).toHaveBeenCalledTimes(0);
    await act(async () => { resolveStart({ runId: 'own-run' }); await pending; });
    await act(() => h.emit());
    expect(load).toHaveBeenCalledTimes(0);
  });

  it('cancels a debounced read on unmount and when a local run starts before the timer fires', async () => {
    const load = vi.fn(async () => []);
    const h = signal(load);
    const transport = createFakeChatTransport();
    const hook = renderHook(() => useChatPane({ transport, agents: [], refreshSignal: h.refreshSignal }));
    h.refreshSignal.focus.dispatchEvent(new Event('focus'));
    await act(() => hook.result.current.conversation.sendMessage('Start locally'));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(load).toHaveBeenCalledTimes(0);
    act(() => transport.finish());
    h.refreshSignal.focus.dispatchEvent(new Event('focus'));
    hook.unmount();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(load).toHaveBeenCalledTimes(0);
  });

  it('preserves a true scroll intent after an owned run finishes and refreshes only on the next focus', async () => {
    const transport = createFakeChatTransport();
    const load = vi.fn(async () => [message('remote', 'Later saved turn')]);
    const h = signal(load);
    const { result } = renderHook(() => useChatPane({ transport, agents: [], refreshSignal: h.refreshSignal }));
    await act(() => result.current.conversation.sendMessage('Local turn'));
    act(() => transport.finish());
    expect(load).toHaveBeenCalledTimes(0);
    expect(result.current.conversation.scrollIntent).toBe(true);
    await act(() => h.emit());
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.conversation.scrollIntent).toBe(true);
    expect(result.current.conversation.messages.map(m => m.content)).toEqual(['Local turn', '', 'Later saved turn']);
  });

  it('drops a late read if a local run starts and finishes during the request', async () => {
    const transport = createFakeChatTransport();
    let resolveLoad!: (messages: ChatMessage[]) => void;
    const load = vi.fn(() => new Promise<ChatMessage[]>(resolve => { resolveLoad = resolve; }));
    const h = signal(load);
    const { result } = renderHook(() => useChatPane({ transport, agents: [], refreshSignal: h.refreshSignal }));
    await act(() => h.emit());
    await act(() => result.current.conversation.sendMessage('New local turn'));
    act(() => { transport.emit({ kind: 'text', text: 'Local answer' }); transport.finish(); });
    await act(async () => { resolveLoad([message('stale', 'Stale result')]); });
    expect(result.current.conversation.messages.map(m => m.content)).toEqual(['New local turn', 'Local answer']);
  });

  it('coalesces in-flight reads and ignores results after subscription replacement or unmount', async () => {
    let resolveLoad!: (messages: ChatMessage[]) => void;
    const load = vi.fn(() => new Promise<ChatMessage[]>(resolve => { resolveLoad = resolve; }));
    const h = signal(load);
    const next = signal(async () => [message('next', 'Next conversation')]);
    const transport = createFakeChatTransport();
    const hook = renderHook(({ source }) => useChatPane({ transport, agents: [], refreshSignal: source }),
      { initialProps: { source: h.refreshSignal } });
    await act(() => h.emit());
    await act(() => h.emit());
    expect(load).toHaveBeenCalledTimes(1);
    hook.rerender({ source: next.refreshSignal });
    await act(async () => { resolveLoad([message('stale', 'Old conversation')]); });
    expect(hook.result.current.conversation.messages).toEqual([]);
    await act(() => next.emit());
    expect(hook.result.current.conversation.messages).toEqual([message('next', 'Next conversation')]);
    hook.unmount();
    await act(() => next.emit());
  });

  it('reports load failure without changing messages and allows another refresh', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const error = new Error('Read unavailable');
    const h = signal(async () => { if (fail) throw error; return [message('saved', 'Read recovered')]; });
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useChatPane({ transport, agents: [], refreshSignal: h.refreshSignal }));
    try {
      await act(() => h.emit());
      expect(result.current.conversation.messages).toEqual([]);
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith('[chat] conversation refresh failed', error);
      fail = false;
      await act(() => h.emit());
      expect(result.current.conversation.messages).toEqual([message('saved', 'Read recovered')]);
    } finally { report.mockRestore(); }
  });
});
