import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment } from '../../../core/index.js';
import { __resetComposerDraftCacheForTests } from '../composer-draft-cache.js';
import { __resetAttachmentPreviewCacheForTests, getAttachmentPreviewSource } from '../attachment-preview-cache.js';
import { useComposer } from '../useComposer.js';
import type { ProjectContextValue } from '../../slots.js';

describe('useComposer', () => {
  it('tracks draft text and canSubmit', () => {
    const { result } = renderHook(() => useComposer());
    expect(result.current.canSubmit).toBe(false);
    act(() => result.current.setDraft('hello'));
    expect(result.current.draft).toBe('hello');
    expect(result.current.canSubmit).toBe(true);
  });

  it('persists draft writes through an injected persistence port, and seeds from it', () => {
    const store = { value: 'seeded draft' };
    const persistence = { read: () => store.value, write: (v: string) => (store.value = v) };
    const { result } = renderHook(() => useComposer({ persistence }));
    expect(result.current.draft).toBe('seeded draft');
    act(() => result.current.setDraft('typed'));
    expect(store.value).toBe('typed');
  });

  it('addAttachments uploads via ProjectContextValue.uploadFiles and stages the results', async () => {
    const uploaded: ChatAttachment = { path: '/tmp/a.png', name: 'a.png', kind: 'image' };
    const uploadFiles = vi.fn().mockResolvedValue([uploaded]);
    const project: ProjectContextValue = { projectId: 'p1', files: [], resolveFileUrl: (p) => p, resolveRawUrl: (p) => p, uploadFiles };
    const { result } = renderHook(() => useComposer({ project }));
    const file = new File(['x'], 'a.png');
    await act(async () => {
      await result.current.addAttachments([file]);
    });
    expect(uploadFiles).toHaveBeenCalledWith([file]);
    expect(result.current.attachments).toEqual([uploaded]);
    expect(result.current.canSubmit).toBe(true);
  });

  describe('caching the original File for later preview', () => {
    afterEach(() => __resetAttachmentPreviewCacheForTests());

    it('caches each uploaded file by its returned attachment path, in order', async () => {
      const uploadedA: ChatAttachment = { path: 'attachment:a', name: 'a.png', kind: 'image' };
      const uploadedB: ChatAttachment = { path: 'attachment:b', name: 'b.txt', kind: 'file' };
      const uploadFiles = vi.fn().mockResolvedValue([uploadedA, uploadedB]);
      const project: ProjectContextValue = { projectId: 'p1', files: [], resolveFileUrl: (p) => p, resolveRawUrl: (p) => p, uploadFiles };
      const { result } = renderHook(() => useComposer({ project }));
      const fileA = new File(['x'], 'a.png');
      const fileB = new File(['y'], 'b.txt');
      await act(async () => {
        await result.current.addAttachments([fileA, fileB]);
      });

      expect(getAttachmentPreviewSource('attachment:a')).toBe(fileA);
      expect(getAttachmentPreviewSource('attachment:b')).toBe(fileB);
    });

    it('does not cache anything when the upload rejects, so a failed batch leaves no stale entries', async () => {
      const uploadFiles = vi.fn().mockRejectedValue(new Error('upload failed'));
      const project: ProjectContextValue = { projectId: 'p1', files: [], resolveFileUrl: (p) => p, resolveRawUrl: (p) => p, uploadFiles };
      const { result } = renderHook(() => useComposer({ project }));
      const file = new File(['x'], 'a.png');
      await act(async () => {
        await expect(result.current.addAttachments([file])).rejects.toThrow('upload failed');
      });

      expect(getAttachmentPreviewSource('attachment:a')).toBeUndefined();
    });
  });

  it('addAttachments rejects when no upload port is wired', async () => {
    const { result } = renderHook(() => useComposer());
    await expect(result.current.addAttachments([new File(['x'], 'a.png')])).rejects.toThrow();
  });

  it('removeAttachment removes by path', () => {
    const { result } = renderHook(() => useComposer());
    act(() => result.current.addAttachment({ path: '/a', name: 'a', kind: 'file' }));
    act(() => result.current.addAttachment({ path: '/b', name: 'b', kind: 'file' }));
    expect(result.current.attachments).toHaveLength(2);
    act(() => result.current.removeAttachment('/a'));
    expect(result.current.attachments.map((a) => a.path)).toEqual(['/b']);
  });

  it('openMention queries every mention source and merges results', async () => {
    const { result } = renderHook(() =>
      useComposer({
        composerSlots: {
          mentionSources: [
            { id: 'skills', label: 'Skills', search: () => [{ id: 's1', label: 'brand-extract' }] },
            { id: 'files', label: 'Files', search: async () => [{ id: 'f1', label: 'index.html' }] },
          ],
        },
      }),
    );
    await act(async () => {
      await result.current.openMention('br');
    });
    await waitFor(() => expect(result.current.mention.results).toHaveLength(2));
    expect(result.current.mention.open).toBe(true);
  });

  it('selectMention inserts the mention into the draft and closes the popover', () => {
    const { result } = renderHook(() => useComposer({ initialDraft: 'check out ' }));
    act(() => result.current.selectMention({ id: 's1', label: 'brand-extract', insertText: '@brand-extract ' }));
    expect(result.current.draft).toBe('check out @brand-extract ');
    expect(result.current.mention.open).toBe(false);
  });

  it('reset() clears draft, attachments, and closes the mention popover', () => {
    const { result } = renderHook(() => useComposer({ initialDraft: 'x' }));
    act(() => result.current.addAttachment({ path: '/a', name: 'a', kind: 'file' }));
    act(() => result.current.reset());
    expect(result.current.draft).toBe('');
    expect(result.current.attachments).toEqual([]);
    expect(result.current.canSubmit).toBe(false);
  });

  it('setAgent updates the current agent selection', () => {
    const { result } = renderHook(() => useComposer());
    expect(result.current.agent).toBeUndefined();
    act(() => result.current.setAgent({ agentId: 'claude', model: 'sonnet' }));
    expect(result.current.agent).toEqual({ agentId: 'claude', model: 'sonnet' });
  });

  it('addAttachments is a no-op (resolves, no upload attempted) when given an empty file list', async () => {
    const uploadFiles = vi.fn();
    const project: ProjectContextValue = { projectId: 'p1', files: [], resolveFileUrl: (p) => p, resolveRawUrl: (p) => p, uploadFiles };
    const { result } = renderHook(() => useComposer({ project }));
    await act(async () => {
      await result.current.addAttachments([]);
    });
    expect(uploadFiles).not.toHaveBeenCalled();
    expect(result.current.attachments).toEqual([]);
  });

  it('addAttachments rejects when a project is wired but has no uploadFiles port', async () => {
    const project: ProjectContextValue = { projectId: 'p1', files: [], resolveFileUrl: (p) => p, resolveRawUrl: (p) => p };
    const { result } = renderHook(() => useComposer({ project }));
    await expect(result.current.addAttachments([new File(['x'], 'a.png')])).rejects.toThrow();
  });

  it('addAttachments calls composerSlots.onAttach for each uploaded file when wired, and skips it when absent', async () => {
    const uploaded: ChatAttachment = { path: '/tmp/a.png', name: 'a.png', kind: 'image' };
    const uploadFiles = vi.fn().mockResolvedValue([uploaded]);
    const project: ProjectContextValue = { projectId: 'p1', files: [], resolveFileUrl: (p) => p, resolveRawUrl: (p) => p, uploadFiles };
    const onAttach = vi.fn();
    const { result } = renderHook(() => useComposer({ project, composerSlots: { onAttach } }));
    await act(async () => {
      await result.current.addAttachments([new File(['x'], 'a.png')]);
    });
    expect(onAttach).toHaveBeenCalledWith(uploaded);

    // Absent onAttach (composerSlots present without it) must not throw.
    const { result: result2 } = renderHook(() => useComposer({ project, composerSlots: {} }));
    await act(async () => {
      await result2.current.addAttachments([new File(['y'], 'b.png')]);
    });
    expect(result2.current.attachments).toHaveLength(1);
  });

  it('openMention returns early (no results fetch) when there are no mention sources at all', async () => {
    const { result } = renderHook(() => useComposer());
    await act(async () => {
      await result.current.openMention('q');
    });
    expect(result.current.mention.open).toBe(true);
    expect(result.current.mention.results).toEqual([]);
  });

  it('openMention swallows a throwing/rejecting mention source and treats it as zero results', async () => {
    const { result } = renderHook(() =>
      useComposer({
        composerSlots: {
          mentionSources: [
            {
              id: 'broken',
              label: 'Broken',
              search: () => {
                throw new Error('boom');
              },
            },
            { id: 'ok', label: 'OK', search: async () => [{ id: 'f1', label: 'index.html' }] },
          ],
        },
      }),
    );
    await act(async () => {
      await result.current.openMention('q');
    });
    await waitFor(() => expect(result.current.mention.results).toHaveLength(1));
  });

  it('openMention ignores a stale response whose query no longer matches the current one', async () => {
    let resolveFirst!: (value: { id: string; label: string }[]) => void;
    const first = new Promise<{ id: string; label: string }[]>((resolve) => {
      resolveFirst = resolve;
    });
    const { result } = renderHook(() =>
      useComposer({
        composerSlots: {
          mentionSources: [
            {
              id: 'dyn',
              label: 'Dyn',
              search: (query: string) => (query === 'first-query' ? first : Promise.resolve([])),
            },
          ],
        },
      }),
    );
    let firstCall!: Promise<void>;
    act(() => {
      firstCall = result.current.openMention('first-query');
    });
    // Start a second query before the first resolves — the stale first response
    // must not clobber the second query's (still-empty) results.
    await act(async () => {
      await result.current.openMention('second-query');
    });
    expect(result.current.mention.query).toBe('second-query');
    resolveFirst([{ id: 'stale', label: 'Stale' }]);
    await act(async () => {
      await firstCall;
    });
    expect(result.current.mention.query).toBe('second-query');
    expect(result.current.mention.results).toEqual([]);
  });

  it('selectMention falls back to "@label " when the mention result has no insertText', () => {
    const { result } = renderHook(() => useComposer({ initialDraft: 'check out ' }));
    act(() => result.current.selectMention({ id: 's1', label: 'brand-extract' }));
    expect(result.current.draft).toBe('check out @brand-extract ');
  });

  describe('per-conversation draft persistence', () => {
    beforeEach(() => __resetComposerDraftCacheForTests());

    it('restores a draft after switching away and back across a remount', () => {
      // Mirrors a host that remounts `ChatPane` (via a conversation-keyed `key`) on a
      // user-initiated conversation switch — see `composer-draft-cache.ts`'s module doc.
      const first = renderHook(() => useComposer({ conversationId: 'convo-a' }));
      act(() => first.result.current.setDraft('buy milk, walk dog, call mom'));
      first.unmount();

      const other = renderHook(() => useComposer({ conversationId: 'convo-b' }));
      expect(other.result.current.draft).toBe('');
      other.unmount();

      const back = renderHook(() => useComposer({ conversationId: 'convo-a' }));
      expect(back.result.current.draft).toBe('buy milk, walk dog, call mom');
    });

    it('never shows one conversation draft to another, with or without a remount', () => {
      const { result, rerender } = renderHook(
        ({ conversationId }: { conversationId: string }) => useComposer({ conversationId }),
        { initialProps: { conversationId: 'convo-a' } },
      );
      act(() => result.current.setDraft('secret plan for A'));

      rerender({ conversationId: 'convo-b' });
      expect(result.current.draft).toBe('');

      act(() => result.current.setDraft('unrelated note for B'));
      rerender({ conversationId: 'convo-a' });
      expect(result.current.draft).toBe('secret plan for A');
    });

    it('clears staged attachments and the mention popover when the conversation changes without a remount', () => {
      const { result, rerender } = renderHook(
        ({ conversationId }: { conversationId: string }) => useComposer({ conversationId }),
        { initialProps: { conversationId: 'convo-a' } },
      );
      act(() => result.current.addAttachment({ path: '/a', name: 'a', kind: 'file' }));
      act(() => void result.current.openMention('q'));
      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.mention.open).toBe(true);

      rerender({ conversationId: 'convo-b' });

      expect(result.current.attachments).toEqual([]);
      expect(result.current.mention.open).toBe(false);
    });

    it('does not cache a draft when there is no conversation id yet (an untitled chat)', () => {
      const first = renderHook(() => useComposer({ conversationId: null }));
      act(() => first.result.current.setDraft('draft with no home yet'));
      first.unmount();

      const other = renderHook(() => useComposer({ conversationId: null }));
      expect(other.result.current.draft).toBe('');
    });

    it('evicts a cleared draft from the cache instead of restoring an empty string', () => {
      const first = renderHook(() => useComposer({ conversationId: 'convo-c' }));
      act(() => first.result.current.setDraft('will be sent'));
      act(() => first.result.current.reset());
      first.unmount();

      const back = renderHook(() => useComposer({ conversationId: 'convo-c' }));
      expect(back.result.current.draft).toBe('');
    });
  });

  /**
   * The bug this covers, reported 2026-09-18: an operator was mid-way through composing in the
   * assistant chat when a site-server restart took the page down, and the text was gone. Resetting
   * the cache with `keepStorage` is the honest simulation — fresh module scope, storage that
   * outlived it.
   */
  describe('draft persistence across a page reload', () => {
    beforeEach(() => __resetComposerDraftCacheForTests());

    it('brings back what was being typed when the page goes down and comes back', () => {
      const before = renderHook(() => useComposer({ conversationId: 'convo-a' }));
      act(() => before.result.current.setDraft('the long message I had not sent yet'));
      before.unmount();

      __resetComposerDraftCacheForTests({ keepStorage: true });

      const after = renderHook(() => useComposer({ conversationId: 'convo-a' }));
      expect(after.result.current.draft).toBe('the long message I had not sent yet');
    });

    it('still keeps conversations apart after a reload', () => {
      const a = renderHook(() => useComposer({ conversationId: 'convo-a' }));
      act(() => a.result.current.setDraft('half-written message for A'));
      a.unmount();

      __resetComposerDraftCacheForTests({ keepStorage: true });

      const b = renderHook(() => useComposer({ conversationId: 'convo-b' }));
      expect(b.result.current.draft).toBe('');
    });

    it('does not bring back a message that was already sent', () => {
      const before = renderHook(() => useComposer({ conversationId: 'convo-a' }));
      act(() => before.result.current.setDraft('this one gets sent'));
      act(() => before.result.current.reset());
      before.unmount();

      __resetComposerDraftCacheForTests({ keepStorage: true });

      const after = renderHook(() => useComposer({ conversationId: 'convo-a' }));
      expect(after.result.current.draft).toBe('');
    });

    it('adopts text typed before the conversation had an id, rather than wiping it', () => {
      const { result, rerender } = renderHook(
        ({ conversationId }: { conversationId: string | null }) => useComposer({ conversationId }),
        { initialProps: { conversationId: null as string | null } },
      );
      act(() => result.current.setDraft('typed before the chat was created'));

      rerender({ conversationId: 'convo-new' });
      expect(result.current.draft).toBe('typed before the chat was created');

      // And it is now durable under the id it was adopted into.
      __resetComposerDraftCacheForTests({ keepStorage: true });
      const after = renderHook(() => useComposer({ conversationId: 'convo-new' }));
      expect(after.result.current.draft).toBe('typed before the chat was created');
    });

    it('prefers a stored draft over adoption when the composer is empty as the id arrives', () => {
      const seeded = renderHook(() => useComposer({ conversationId: 'convo-seeded' }));
      act(() => seeded.result.current.setDraft('what was already saved here'));
      seeded.unmount();
      __resetComposerDraftCacheForTests({ keepStorage: true });

      const { result, rerender } = renderHook(
        ({ conversationId }: { conversationId: string | null }) => useComposer({ conversationId }),
        { initialProps: { conversationId: null as string | null } },
      );
      rerender({ conversationId: 'convo-seeded' });
      expect(result.current.draft).toBe('what was already saved here');
    });

    it('does not adopt across a real conversation switch', () => {
      const { result, rerender } = renderHook(
        ({ conversationId }: { conversationId: string }) => useComposer({ conversationId }),
        { initialProps: { conversationId: 'convo-a' } },
      );
      act(() => result.current.setDraft('belongs to A only'));

      rerender({ conversationId: 'convo-b' });

      expect(result.current.draft).toBe('');
    });
  });
});
