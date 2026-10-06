import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetComposerDraftCacheForTests,
  clearCachedDraft,
  COMPOSER_ATTACHMENTS_STORAGE_PREFIX,
  COMPOSER_DRAFT_STORAGE_PREFIX,
  MAX_CACHED_CONVERSATION_DRAFTS,
  readCachedAttachmentBatchId,
  readCachedDraft,
  writeCachedAttachmentBatchId,
  writeCachedAttachments,
  writeCachedDraft,
} from '../composer-draft-cache.js';

describe('composer-draft-cache', () => {
  beforeEach(() => __resetComposerDraftCacheForTests());

  it('returns null for a conversation that was never written', () => {
    expect(readCachedDraft({ conversationId: 'never-touched' })).toBeNull();
  });

  it('round-trips a written draft', () => {
    writeCachedDraft({ conversationId: 'convo-a', draft: 'hello there' });
    expect(readCachedDraft({ conversationId: 'convo-a' })).toBe('hello there');
  });

  it('is a no-op read/write for a null or undefined conversation id', () => {
    writeCachedDraft({ conversationId: null, draft: 'x' });
    writeCachedDraft({ conversationId: undefined, draft: 'y' });
    expect(readCachedDraft({ conversationId: null })).toBeNull();
    expect(readCachedDraft({ conversationId: undefined })).toBeNull();
  });

  it('deletes the entry when the draft is written back as blank or whitespace-only', () => {
    writeCachedDraft({ conversationId: 'convo-a', draft: 'hello there' });
    writeCachedDraft({ conversationId: 'convo-a', draft: '   ' });
    expect(readCachedDraft({ conversationId: 'convo-a' })).toBeNull();
  });

  it('evicts the oldest tracked conversation once the cap is exceeded', () => {
    for (let i = 0; i < MAX_CACHED_CONVERSATION_DRAFTS; i += 1) {
      writeCachedDraft({ conversationId: `convo-${i}`, draft: `draft ${i}` });
    }
    expect(readCachedDraft({ conversationId: 'convo-0' })).toBe('draft 0');

    writeCachedDraft({ conversationId: 'convo-overflow', draft: 'one more than the cap' });

    expect(readCachedDraft({ conversationId: 'convo-0' })).toBeNull();
    expect(readCachedDraft({ conversationId: 'convo-overflow' })).toBe('one more than the cap');
  });

  it('does not evict anything when overwriting an already-tracked conversation at the cap', () => {
    for (let i = 0; i < MAX_CACHED_CONVERSATION_DRAFTS; i += 1) {
      writeCachedDraft({ conversationId: `convo-${i}`, draft: `draft ${i}` });
    }
    writeCachedDraft({ conversationId: 'convo-0', draft: 'draft 0 edited' });
    expect(readCachedDraft({ conversationId: 'convo-0' })).toBe('draft 0 edited');
    expect(readCachedDraft({ conversationId: 'convo-1' })).toBe('draft 1');
  });

  it('clearCachedDraft removes an entry explicitly', () => {
    writeCachedDraft({ conversationId: 'convo-a', draft: 'hello there' });
    clearCachedDraft({ conversationId: 'convo-a' });
    expect(readCachedDraft({ conversationId: 'convo-a' })).toBeNull();
  });

  it('clearCachedDraft is a no-op for a null or undefined conversation id', () => {
    expect(() => clearCachedDraft({ conversationId: null })).not.toThrow();
    expect(() => clearCachedDraft({ conversationId: undefined })).not.toThrow();
  });
});

/**
 * The reason this cache exists at all after 2026-09-18: an operator lost a half-written message to
 * a site-server restart. A reload drops this module's scope but NOT `localStorage`, so
 * `__resetComposerDraftCacheForTests({ keepStorage: true })` is the closest honest simulation of one.
 */
describe('composer-draft-cache durability across a reload', () => {
  beforeEach(() => __resetComposerDraftCacheForTests());

  it('still has the draft after a reload drops this module scope but not storage', () => {
    writeCachedDraft({ conversationId: 'convo-a', draft: 'half a sentence the operator was still typing' });
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft({ conversationId: 'convo-a' })).toBe('half a sentence the operator was still typing');
  });

  it('keeps each conversation separate across a reload', () => {
    writeCachedDraft({ conversationId: 'convo-a', draft: 'draft for A' });
    writeCachedDraft({ conversationId: 'convo-b', draft: 'draft for B' });
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft({ conversationId: 'convo-a' })).toBe('draft for A');
    expect(readCachedDraft({ conversationId: 'convo-b' })).toBe('draft for B');
    expect(readCachedDraft({ conversationId: 'convo-never-typed-in' })).toBeNull();
  });

  it('does not resurrect a sent draft after a reload', () => {
    writeCachedDraft({ conversationId: 'convo-a', draft: 'about to be sent' });
    writeCachedDraft({ conversationId: 'convo-a', draft: '' });
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft({ conversationId: 'convo-a' })).toBeNull();
  });

  it('does not resurrect an explicitly cleared draft after a reload', () => {
    writeCachedDraft({ conversationId: 'convo-a', draft: 'cleared by the host' });
    clearCachedDraft({ conversationId: 'convo-a' });
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft({ conversationId: 'convo-a' })).toBeNull();
  });

  it('bounds how many conversations it keeps in storage, oldest first', () => {
    for (let i = 0; i < MAX_CACHED_CONVERSATION_DRAFTS; i += 1) {
      writeCachedDraft({ conversationId: `convo-${i}`, draft: `draft ${i}` });
    }
    writeCachedDraft({ conversationId: 'convo-overflow', draft: 'one more than the cap' });
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft({ conversationId: 'convo-0' })).toBeNull();
    expect(readCachedDraft({ conversationId: 'convo-overflow' })).toBe('one more than the cap');
  });
});

describe('composer-draft-cache when storage misbehaves', () => {
  beforeEach(() => __resetComposerDraftCacheForTests());
  afterEach(() => vi.unstubAllGlobals());

  /** Stands in for a private window, blocked site data, or a non-browser runtime. */
  function stubThrowingStorage(): void {
    const throwing = {
      get length(): number {
        throw new Error('storage is blocked');
      },
      key: () => {
        throw new Error('storage is blocked');
      },
      getItem: () => {
        throw new Error('storage is blocked');
      },
      setItem: () => {
        throw new Error('storage is blocked');
      },
      removeItem: () => {
        throw new Error('storage is blocked');
      },
      clear: () => {
        throw new Error('storage is blocked');
      },
    };
    vi.stubGlobal('localStorage', throwing as unknown as Storage);
  }

  it('degrades to in-memory only rather than throwing when storage is blocked', () => {
    stubThrowingStorage();
    expect(() => writeCachedDraft({ conversationId: 'convo-a', draft: 'typed with storage blocked' })).not.toThrow();
    expect(readCachedDraft({ conversationId: 'convo-a' })).toBe('typed with storage blocked');
    expect(() => clearCachedDraft({ conversationId: 'convo-a' })).not.toThrow();
    expect(readCachedDraft({ conversationId: 'convo-a' })).toBeNull();
  });

  it('survives a storage read that returns something this module did not write', () => {
    localStorage.setItem(`${COMPOSER_DRAFT_STORAGE_PREFIX}convo-a`, 'not json at all');
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft({ conversationId: 'convo-a' })).toBeNull();
    expect(localStorage.getItem(`${COMPOSER_DRAFT_STORAGE_PREFIX}convo-a`)).toBeNull();
  });

  it('survives a stored envelope whose draft field is the wrong type', () => {
    localStorage.setItem(`${COMPOSER_DRAFT_STORAGE_PREFIX}convo-a`, JSON.stringify({ v: 1, t: 1, d: 42 }));
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft({ conversationId: 'convo-a' })).toBeNull();
  });

  it('keeps serving the in-memory draft when a later storage read fails', () => {
    writeCachedDraft({ conversationId: 'convo-a', draft: 'already in memory' });
    stubThrowingStorage();
    expect(readCachedDraft({ conversationId: 'convo-a' })).toBe('already in memory');
  });
});

describe('composer-draft-cache attachment batch ids', () => {
  const staged = [{ path: '/uploads/batch-1/a.png', name: 'a.png', kind: 'image' as const }];

  beforeEach(() => __resetComposerDraftCacheForTests());

  it('returns the batch the cached attachments were staged under', () => {
    writeCachedAttachmentBatchId({ conversationId: 'convo-a', batchId: 'batch-1' });
    writeCachedAttachments({ conversationId: 'convo-a', attachments: staged });
    expect(readCachedAttachmentBatchId({ conversationId: 'convo-a' })).toBe('batch-1');
  });

  it('survives a reload alongside the attachments it describes', () => {
    writeCachedAttachmentBatchId({ conversationId: 'convo-a', batchId: 'batch-1' });
    writeCachedAttachments({ conversationId: 'convo-a', attachments: staged });
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedAttachmentBatchId({ conversationId: 'convo-a' })).toBe('batch-1');
  });

  it('returns null when no attachments are cached, even with a recorded batch', () => {
    // A host with no validator never persists attachments; reusing a batch nothing restored would
    // hand the next turn a directory holding files the operator never re-staged.
    writeCachedAttachmentBatchId({ conversationId: 'convo-a', batchId: 'batch-1' });
    expect(readCachedAttachmentBatchId({ conversationId: 'convo-a' })).toBeNull();
  });

  it('forgets the batch once the staged attachments are cleared', () => {
    writeCachedAttachmentBatchId({ conversationId: 'convo-a', batchId: 'batch-1' });
    writeCachedAttachments({ conversationId: 'convo-a', attachments: staged });
    writeCachedAttachments({ conversationId: 'convo-a', attachments: [] });
    writeCachedAttachments({ conversationId: 'convo-a', attachments: staged });
    expect(readCachedAttachmentBatchId({ conversationId: 'convo-a' })).toBeNull();
  });

  it('restores the attachments but no batch from an entry written before batch ids were stored', () => {
    localStorage.setItem(`${COMPOSER_ATTACHMENTS_STORAGE_PREFIX}convo-a`, JSON.stringify({ v: 1, t: 1, a: staged }));
    expect(readCachedAttachmentBatchId({ conversationId: 'convo-a' })).toBeNull();
  });

  it('drops a stored batch id that is not a non-empty string', () => {
    localStorage.setItem(`${COMPOSER_ATTACHMENTS_STORAGE_PREFIX}convo-a`, JSON.stringify({ v: 1, t: 1, a: staged, b: 42 }));
    localStorage.setItem(`${COMPOSER_ATTACHMENTS_STORAGE_PREFIX}convo-b`, JSON.stringify({ v: 1, t: 1, a: staged, b: '' }));
    expect(readCachedAttachmentBatchId({ conversationId: 'convo-a' })).toBeNull();
    expect(readCachedAttachmentBatchId({ conversationId: 'convo-b' })).toBeNull();
  });

  it('is a no-op read/write for a null or undefined conversation id', () => {
    writeCachedAttachmentBatchId({ conversationId: null, batchId: 'batch-1' });
    writeCachedAttachmentBatchId({ conversationId: undefined, batchId: 'batch-1' });
    expect(readCachedAttachmentBatchId({ conversationId: null })).toBeNull();
    expect(readCachedAttachmentBatchId({ conversationId: undefined })).toBeNull();
  });

  it('evicts the oldest recorded batch once the cap is exceeded', () => {
    for (let i = 0; i <= MAX_CACHED_CONVERSATION_DRAFTS; i += 1) {
      writeCachedAttachmentBatchId({ conversationId: `convo-${i}`, batchId: `batch-${i}` });
    }
    // Re-recording a tracked conversation at the cap evicts nothing.
    writeCachedAttachmentBatchId({ conversationId: 'convo-1', batchId: 'batch-1b' });
    for (const i of [0, 1, MAX_CACHED_CONVERSATION_DRAFTS]) {
      writeCachedAttachments({ conversationId: `convo-${i}`, attachments: staged });
    }
    expect(readCachedAttachmentBatchId({ conversationId: 'convo-0' })).toBeNull();
    expect(readCachedAttachmentBatchId({ conversationId: 'convo-1' })).toBe('batch-1b');
    expect(readCachedAttachmentBatchId({ conversationId: `convo-${MAX_CACHED_CONVERSATION_DRAFTS}` }))
      .toBe(`batch-${MAX_CACHED_CONVERSATION_DRAFTS}`);
  });
});
