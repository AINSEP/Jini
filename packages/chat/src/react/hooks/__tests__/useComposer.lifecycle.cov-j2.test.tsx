/**
 * The page-exit and attachment-restore edges of `useComposer`: which page signals flush a pending
 * draft write (and what happens where there is no page at all), and how a slow attachment
 * validator's answer is applied — or dropped — once the composer has moved on.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment } from '../../../core/index.js';
import {
  COMPOSER_DRAFT_STORAGE_PREFIX,
  __resetComposerDraftCacheForTests,
  readCachedAttachments,
} from '../composer-draft-cache.js';
import { browserPageLifecycle, useComposer, type ComposerPageLifecycle } from '../useComposer.js';

function storedDraft(conversationId: string): string | null {
  const raw = localStorage.getItem(`${COMPOSER_DRAFT_STORAGE_PREFIX}${conversationId}`);
  return raw === null ? null : (JSON.parse(raw) as { d: string }).d;
}

/** A hand-written page: two plain event targets and a settable visibility state. */
function fakePage(): ComposerPageLifecycle & { hide: () => void; show: () => void; listenerCount: () => number } {
  const page = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  let listeners = 0;
  const track = <T extends EventTarget>(target: T): T => {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (...args: Parameters<EventTarget['addEventListener']>) => { listeners += 1; add(...args); };
    target.removeEventListener = (...args: Parameters<EventTarget['removeEventListener']>) => { listeners -= 1; remove(...args); };
    return target;
  };
  return {
    window: track(page) as unknown as ComposerPageLifecycle['window'],
    document: track(doc) as unknown as ComposerPageLifecycle['document'],
    hide: () => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); },
    show: () => { doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); },
    listenerCount: () => listeners,
  };
}

describe('useComposer page-exit flush', () => {
  beforeEach(() => {
    __resetComposerDraftCacheForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes the pending draft write when the document becomes hidden, and not when it becomes visible', () => {
    const page = fakePage();
    const { result } = renderHook(() => useComposer({ conversationId: 'c1', pageLifecycle: page }));
    act(() => result.current.setDraft('tab switching'));

    act(() => page.show());
    expect(storedDraft('c1')).toBeNull();

    act(() => page.hide());
    expect(storedDraft('c1')).toBe('tab switching');
  });

  it('flushes on the injected page\'s pagehide and unsubscribes on unmount', () => {
    const page = fakePage();
    const { result, unmount } = renderHook(() => useComposer({ conversationId: 'c1', pageLifecycle: page }));
    expect(page.listenerCount()).toBe(2);
    act(() => result.current.setDraft('leaving'));
    act(() => {
      page.window.dispatchEvent(new Event('pagehide'));
    });
    expect(storedDraft('c1')).toBe('leaving');
    unmount();
    expect(page.listenerCount()).toBe(0);
  });

  it('with no page to leave, ignores browser page events but still flushes on unmount', () => {
    const { result, unmount } = renderHook(() => useComposer({ conversationId: 'c1', pageLifecycle: null }));
    act(() => result.current.setDraft('non-DOM renderer'));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(storedDraft('c1')).toBeNull();
    unmount();
    expect(storedDraft('c1')).toBe('non-DOM renderer');
  });
});

describe('browserPageLifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is the real window and document in a browser', () => {
    expect(browserPageLifecycle()).toEqual({ window, document });
  });

  it('is null in a runtime without window', () => {
    vi.stubGlobal('window', undefined);
    expect(browserPageLifecycle()).toBeNull();
  });
});

describe('useComposer attachment restore after the composer moved on', () => {
  beforeEach(() => __resetComposerDraftCacheForTests());

  const FILE: ChatAttachment = { path: 'attachment:abc-123', name: 'notes.md', kind: 'file' };
  const IMAGE: ChatAttachment = { path: 'attachment:def-456', name: 'shot.png', kind: 'image' };

  async function stageAndReload(attachment: ChatAttachment): Promise<void> {
    const keepAll = async (a: readonly ChatAttachment[]) => a;
    const before = renderHook(() => useComposer({ conversationId: 'convo-a', validateAttachments: keepAll }));
    act(() => before.result.current.addAttachment(attachment));
    await waitFor(() => expect(before.result.current.attachments).toHaveLength(1));
    before.unmount();
    __resetComposerDraftCacheForTests({ keepStorage: true });
  }

  function deferredValidator() {
    let settle: (valid: readonly ChatAttachment[]) => void = () => {};
    const validate = vi.fn(() => new Promise<readonly ChatAttachment[]>((resolve) => { settle = resolve; }));
    return { validate, settle: (valid: readonly ChatAttachment[]) => settle(valid) };
  }

  it('drops a validator answer that arrives after unmount, leaving the cached references untouched', async () => {
    await stageAndReload(FILE);
    const { validate, settle } = deferredValidator();
    const after = renderHook(() => useComposer({ conversationId: 'convo-a', validateAttachments: validate }));
    await waitFor(() => expect(validate).toHaveBeenCalledWith([FILE]));
    after.unmount();

    // "None survived" would purge the cache — but this answer belongs to an unmounted composer.
    await act(async () => settle([]));
    expect(readCachedAttachments({ conversationId: 'convo-a' })).toEqual([FILE]);
  });

  it('keeps what the operator staged while validation was in flight instead of the restore', async () => {
    await stageAndReload(FILE);
    const { validate, settle } = deferredValidator();
    const { result } = renderHook(() => useComposer({ conversationId: 'convo-a', validateAttachments: validate }));
    await waitFor(() => expect(validate).toHaveBeenCalled());
    act(() => result.current.addAttachment(IMAGE));

    await act(async () => settle([FILE]));
    expect(result.current.attachments).toEqual([IMAGE]);
  });
});
