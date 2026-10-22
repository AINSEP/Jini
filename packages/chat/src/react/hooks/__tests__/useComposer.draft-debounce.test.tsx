/**
 * Draft persistence is debounced, never lossy. Owner report 2026-10-08: typing in a long assistant
 * conversation lagged, and every keystroke synchronously wrote the draft to `localStorage` plus the
 * host's persistence port. The durable writes now wait for a pause in typing; every exit path
 * (send, conversation switch, unmount, page hide, composer blur) writes or discards immediately.
 */
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../../components/Composer.js';
import {
  COMPOSER_DRAFT_STORAGE_PREFIX,
  __resetComposerDraftCacheForTests,
  readCachedDraft,
} from '../composer-draft-cache.js';
import { DRAFT_PERSIST_DEBOUNCE_MS, useComposer } from '../useComposer.js';

function storedDraft(conversationId: string): string | null {
  const raw = localStorage.getItem(`${COMPOSER_DRAFT_STORAGE_PREFIX}${conversationId}`);
  return raw === null ? null : (JSON.parse(raw) as { d: string }).d;
}

describe('useComposer draft persistence debounce', () => {
  beforeEach(() => {
    __resetComposerDraftCacheForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes storage and the persistence port once, with the latest text, after typing pauses', () => {
    const write = vi.fn();
    const { result } = renderHook(() => useComposer({ conversationId: 'c1', persistence: { read: () => null, write } }));
    act(() => result.current.setDraft('h'));
    act(() => result.current.setDraft('he'));
    act(() => result.current.setDraft('hey'));

    expect(storedDraft('c1')).toBeNull();
    expect(write).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(DRAFT_PERSIST_DEBOUNCE_MS - 1));
    expect(storedDraft('c1')).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(storedDraft('c1')).toBe('hey');
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('hey');
  });

  it('keeps the in-memory tier current on every keystroke, so a remount mid-typing still restores', () => {
    const { result } = renderHook(() => useComposer({ conversationId: 'c1' }));
    act(() => result.current.setDraft('mid sentence'));
    expect(readCachedDraft({ conversationId: 'c1' })).toBe('mid sentence');
  });

  it('flushes the pending write on unmount', () => {
    const { result, unmount } = renderHook(() => useComposer({ conversationId: 'c1' }));
    act(() => result.current.setDraft('typed then navigated away'));
    unmount();
    expect(storedDraft('c1')).toBe('typed then navigated away');
  });

  it('flushes the pending write for the conversation being left on a switch', () => {
    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string }) => useComposer({ conversationId }),
      { initialProps: { conversationId: 'a' } },
    );
    act(() => result.current.setDraft('belongs to A'));
    rerender({ conversationId: 'b' });

    expect(storedDraft('a')).toBe('belongs to A');
    expect(storedDraft('b')).toBeNull();
    act(() => vi.advanceTimersByTime(DRAFT_PERSIST_DEBOUNCE_MS));
    expect(storedDraft('b')).toBeNull();
  });

  it('flushes the pending write when the page is hidden', () => {
    const { result } = renderHook(() => useComposer({ conversationId: 'c1' }));
    act(() => result.current.setDraft('about to reload'));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(storedDraft('c1')).toBe('about to reload');
  });

  it('a send clears immediately and a stale pending write never resurrects the sent text', () => {
    const write = vi.fn();
    const { result } = renderHook(() => useComposer({ conversationId: 'c1', persistence: { read: () => null, write } }));
    act(() => result.current.setDraft('this gets sent'));
    act(() => result.current.reset());

    expect(storedDraft('c1')).toBeNull();
    expect(write).toHaveBeenLastCalledWith('');
    act(() => vi.advanceTimersByTime(DRAFT_PERSIST_DEBOUNCE_MS * 2));
    expect(storedDraft('c1')).toBeNull();
    expect(write).toHaveBeenLastCalledWith('');
  });

  it('flushDraft writes the pending draft immediately', () => {
    const { result } = renderHook(() => useComposer({ conversationId: 'c1' }));
    act(() => result.current.setDraft('flush me'));
    act(() => result.current.flushDraft?.());
    expect(storedDraft('c1')).toBe('flush me');
  });

  it('the composer textarea flushes the draft on blur', () => {
    function Harness() {
      const composer = useComposer({ conversationId: 'c1' });
      return <Composer composer={composer} onSend={() => {}} />;
    }
    const { container } = render(<Harness />);
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'typed then clicked away' } });
    expect(storedDraft('c1')).toBeNull();
    fireEvent.blur(textarea);
    expect(storedDraft('c1')).toBe('typed then clicked away');
  });
});
