import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment, ChatMessage } from '../../../core/index.js';
import { useAttachmentGallery } from '../AttachmentGallery.hooks.js';
import { useConversationListTitles } from '../ConversationList.hooks.js';
import { useMessageListAutoScroll } from '../MessageList.hooks.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('useAttachmentGallery', () => {
  it('ignores a stale previous/next after the preview closed', () => {
    const images: ChatAttachment[] = [
      { path: 'attachment:1', name: 'one.png', kind: 'image' },
      { path: 'attachment:2', name: 'two.png', kind: 'image' },
    ];
    const { result } = renderHook(() => useAttachmentGallery({ attachments: images }));
    act(() => result.current.open(images[0]!));
    const staleNavigation = result.current.navigation!;
    act(() => staleNavigation.onNext());
    expect(result.current.opened?.name).toBe('two.png');
    act(() => result.current.close());
    act(() => staleNavigation.onPrevious());
    expect(result.current.opened).toBeNull();
    expect(result.current.navigation).toBeUndefined();
  });
});

describe('useConversationListTitles', () => {
  it('shows a title that is only markup as untitled but keeps the raw title for editing', () => {
    const conversations = [{ id: 'a', title: '``~~' }, { id: 'b', title: '**Plan** next' }, { id: 'c', title: null }];
    const { result } = renderHook(() => useConversationListTitles({ conversations, serverResults: null }));
    expect(result.current.conversations.map(item => item.title)).toEqual([null, 'Plan next', null]);
    expect(result.current.rawTitles.get('a')).toBe('``~~');
    expect(result.current.serverResults).toBeNull();
  });

  it('lets a server search result supply the newer raw title of a loaded conversation', () => {
    const conversations = [{ id: 'a', title: 'Old' }];
    const serverResults = [{ id: 'a', title: '*Newer*' }, { id: 'z', title: null }];
    const { result } = renderHook(() => useConversationListTitles({ conversations, serverResults }));
    expect(result.current.serverResults?.map(item => item.title)).toEqual(['Newer', null]);
    expect(result.current.rawTitles.get('a')).toBe('*Newer*');
    expect(conversations[0]!.title).toBe('Old');
  });
});

function mountedScroller() {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { value: 900 });
  const scrollTo = vi.fn();
  el.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
  return { el, scrollTo };
}

describe('useMessageListAutoScroll', () => {
  const messages: ChatMessage[] = [];

  it('jumping to latest without a mounted container is a no-op', () => {
    const { result } = renderHook(() => useMessageListAutoScroll({ messages, scrollIntent: false }));
    expect(() => result.current.jumpToLatest()).not.toThrow();
    expect(result.current.awayFromLatest).toBe(false);
  });

  it('smooth-scrolls by default when the browser has no reduced-motion query', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMessageListAutoScroll({ messages, scrollIntent: false }));
    const { el, scrollTo } = mountedScroller();
    result.current.containerRef.current = el;
    act(() => result.current.jumpToLatest());
    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'smooth' });
  });

  it('jumps instantly when the user prefers reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }));
    const { result } = renderHook(() => useMessageListAutoScroll({ messages, scrollIntent: false }));
    const { el, scrollTo } = mountedScroller();
    result.current.containerRef.current = el;
    act(() => result.current.jumpToLatest());
    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'auto' });
  });

  it('still scrolls on new output in a browser without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 400 });
    const onScrolled = vi.fn();
    const { result, rerender } = renderHook(
      ({ intent }) => {
        const view = useMessageListAutoScroll({ messages, scrollIntent: intent }, { onScrolled });
        view.containerRef.current = el;
        return view;
      },
      { initialProps: { intent: false } },
    );
    rerender({ intent: true });
    expect(el.scrollTop).toBe(400);
    expect(onScrolled).toHaveBeenCalledOnce();
    expect(result.current.awayFromLatest).toBe(false);
  });
});
