import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComposer, type UseComposerOptions } from '../useComposer.js';
import { __resetComposerDraftCacheForTests, COMPOSER_DRAFT_STORAGE_PREFIX } from '../composer-draft-cache.js';

function release(): boolean {
  return window.dispatchEvent(new Event('jini:release-check', { cancelable: true }));
}

describe('composer release safety', () => {
  beforeEach(() => { __resetComposerDraftCacheForTests(); vi.useFakeTimers(); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('flushes the pending draft before release and restores it after a remount', () => {
    const first = renderHook(() => useComposer({ conversationId: 'release' }));
    act(() => first.result.current.setDraft('unfinished message'));
    expect(localStorage.getItem(`${COMPOSER_DRAFT_STORAGE_PREFIX}release`)).toBeNull();
    expect(release()).toBe(true);
    expect(JSON.parse(localStorage.getItem(`${COMPOSER_DRAFT_STORAGE_PREFIX}release`)!)).toMatchObject({ d: 'unfinished message' });
    first.unmount();
    __resetComposerDraftCacheForTests({ keepStorage: true });
    const next = renderHook(() => useComposer({ conversationId: 'release' }));
    expect(next.result.current.draft).toBe('unfinished message');
  });

  it('unsent text blocks release with storage denied, including after the debounce', () => {
    const { result } = renderHook(() => useComposer({ conversationId: 'denied' }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => result.current.setDraft('keep my words'));
    expect(release()).toBe(false);
    act(() => vi.advanceTimersByTime(800));
    expect(release()).toBe(false);
    expect(result.current.draft).toBe('keep my words');
  });

  it('an unkeyed draft cannot release and a clean composer needs no storage', () => {
    const { result } = renderHook(() => useComposer());
    expect(release()).toBe(true);
    act(() => result.current.setDraft('no conversation yet'));
    expect(release()).toBe(false);
    act(() => result.current.reset());
    expect(release()).toBe(true);
  });

  it('staged files without a restoration port and folders with denied storage block release', () => {
    const { result } = renderHook(() => useComposer({ conversationId: 'staged' }));
    act(() => result.current.addAttachment({ path: '/a.png', name: 'a.png', kind: 'image' }));
    expect(release()).toBe(false);
    act(() => result.current.clearAttachments());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => result.current.addFolders({ folders: ['/work'] }));
    expect(release()).toBe(false);
  });

  it('pending uploads block release even before a staged file exists', async () => {
    let rejectUpload!: (error: Error) => void;
    const { result } = renderHook(() => useComposer({ project: {
      projectId: 'project', files: [], resolveFileUrl: path => path, resolveRawUrl: path => path,
      uploadFiles: () => new Promise<never>((_resolve, reject) => { rejectUpload = reject; }),
    } }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.addAttachments([new File(['x'], 'x.txt')]); });
    expect(release()).toBe(false);
    await act(async () => { rejectUpload(new Error('failed')); await pending.catch(() => {}); });
    expect(release()).toBe(true);
  });

  it('durable staged files and folders survive release through the existing restoration owner', async () => {
    vi.useRealTimers();
    const attachment = { path: '/a.png', name: 'a.png', kind: 'image' as const };
    const options = { conversationId: 'restorable', validateAttachments: async () => [attachment] };
    const first = renderHook(() => useComposer(options));
    act(() => {
      first.result.current.addAttachment(attachment);
      first.result.current.addFolders({ folders: ['/work'] });
    });
    expect(release()).toBe(true);
    first.unmount();
    __resetComposerDraftCacheForTests({ keepStorage: true });
    const next = renderHook(() => useComposer(options));
    await waitFor(() => expect(next.result.current.attachments).toEqual([attachment]));
    expect(next.result.current.folders).toEqual(['/work']);
  });

  it('release checks add no reload prompt and detach on unmount', () => {
    const { result, unmount } = renderHook(() => useComposer({ conversationId: 'detach' }));
    act(() => result.current.setDraft('typing'));
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
    unmount();
    expect(release()).toBe(true);
  });

  it('cleared text, files and folders stay cleared after failed storage deletion and remount', async () => {
    vi.useRealTimers();
    const attachment = { path: '/old.png', name: 'old.png', kind: 'image' as const };
    const options: UseComposerOptions = { conversationId: 'deleted', validateAttachments: async files => files };
    const first = renderHook(() => useComposer(options));
    act(() => {
      first.result.current.setDraft('old draft');
      first.result.current.addAttachment(attachment);
      first.result.current.addFolders({ folders: ['/old'] });
    });
    expect(release()).toBe(true);
    first.unmount();
    __resetComposerDraftCacheForTests({ keepStorage: true });
    const editing = renderHook(() => useComposer(options));
    await waitFor(() => expect(editing.result.current.attachments).toEqual([attachment]));
    expect(editing.result.current.draft).toBe('old draft');
    expect(editing.result.current.folders).toEqual(['/old']);
    const deletion = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    act(() => editing.result.current.reset());
    expect(editing.result.current.draft).toBe('');
    expect(editing.result.current.attachments).toEqual([]);
    expect(editing.result.current.folders).toEqual([]);
    expect(release()).toBe(false);
    deletion.mockRestore();
    expect(release()).toBe(true);
    editing.unmount();
    __resetComposerDraftCacheForTests({ keepStorage: true });
    const restored = renderHook(() => useComposer(options));
    expect(restored.result.current.draft).toBe('');
    expect(restored.result.current.attachments).toEqual([]);
    expect(restored.result.current.folders).toEqual([]);
  });
});
