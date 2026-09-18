import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetComposerDraftCacheForTests,
  clearCachedDraft,
  COMPOSER_DRAFT_STORAGE_PREFIX,
  MAX_CACHED_CONVERSATION_DRAFTS,
  readCachedDraft,
  writeCachedDraft,
} from '../composer-draft-cache.js';

describe('composer-draft-cache', () => {
  beforeEach(() => __resetComposerDraftCacheForTests());

  it('returns null for a conversation that was never written', () => {
    expect(readCachedDraft('never-touched')).toBeNull();
  });

  it('round-trips a written draft', () => {
    writeCachedDraft('convo-a', 'hello there');
    expect(readCachedDraft('convo-a')).toBe('hello there');
  });

  it('is a no-op read/write for a null or undefined conversation id', () => {
    writeCachedDraft(null, 'x');
    writeCachedDraft(undefined, 'y');
    expect(readCachedDraft(null)).toBeNull();
    expect(readCachedDraft(undefined)).toBeNull();
  });

  it('deletes the entry when the draft is written back as blank or whitespace-only', () => {
    writeCachedDraft('convo-a', 'hello there');
    writeCachedDraft('convo-a', '   ');
    expect(readCachedDraft('convo-a')).toBeNull();
  });

  it('evicts the oldest tracked conversation once the cap is exceeded', () => {
    for (let i = 0; i < MAX_CACHED_CONVERSATION_DRAFTS; i += 1) {
      writeCachedDraft(`convo-${i}`, `draft ${i}`);
    }
    expect(readCachedDraft('convo-0')).toBe('draft 0');

    writeCachedDraft('convo-overflow', 'one more than the cap');

    expect(readCachedDraft('convo-0')).toBeNull();
    expect(readCachedDraft('convo-overflow')).toBe('one more than the cap');
  });

  it('does not evict anything when overwriting an already-tracked conversation at the cap', () => {
    for (let i = 0; i < MAX_CACHED_CONVERSATION_DRAFTS; i += 1) {
      writeCachedDraft(`convo-${i}`, `draft ${i}`);
    }
    writeCachedDraft('convo-0', 'draft 0 edited');
    expect(readCachedDraft('convo-0')).toBe('draft 0 edited');
    expect(readCachedDraft('convo-1')).toBe('draft 1');
  });

  it('clearCachedDraft removes an entry explicitly', () => {
    writeCachedDraft('convo-a', 'hello there');
    clearCachedDraft('convo-a');
    expect(readCachedDraft('convo-a')).toBeNull();
  });

  it('clearCachedDraft is a no-op for a null or undefined conversation id', () => {
    expect(() => clearCachedDraft(null)).not.toThrow();
    expect(() => clearCachedDraft(undefined)).not.toThrow();
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
    writeCachedDraft('convo-a', 'half a sentence the operator was still typing');
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft('convo-a')).toBe('half a sentence the operator was still typing');
  });

  it('keeps each conversation separate across a reload', () => {
    writeCachedDraft('convo-a', 'draft for A');
    writeCachedDraft('convo-b', 'draft for B');
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft('convo-a')).toBe('draft for A');
    expect(readCachedDraft('convo-b')).toBe('draft for B');
    expect(readCachedDraft('convo-never-typed-in')).toBeNull();
  });

  it('does not resurrect a sent draft after a reload', () => {
    writeCachedDraft('convo-a', 'about to be sent');
    writeCachedDraft('convo-a', '');
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft('convo-a')).toBeNull();
  });

  it('does not resurrect an explicitly cleared draft after a reload', () => {
    writeCachedDraft('convo-a', 'cleared by the host');
    clearCachedDraft('convo-a');
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft('convo-a')).toBeNull();
  });

  it('bounds how many conversations it keeps in storage, oldest first', () => {
    for (let i = 0; i < MAX_CACHED_CONVERSATION_DRAFTS; i += 1) {
      writeCachedDraft(`convo-${i}`, `draft ${i}`);
    }
    writeCachedDraft('convo-overflow', 'one more than the cap');
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft('convo-0')).toBeNull();
    expect(readCachedDraft('convo-overflow')).toBe('one more than the cap');
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
    expect(() => writeCachedDraft('convo-a', 'typed with storage blocked')).not.toThrow();
    expect(readCachedDraft('convo-a')).toBe('typed with storage blocked');
    expect(() => clearCachedDraft('convo-a')).not.toThrow();
    expect(readCachedDraft('convo-a')).toBeNull();
  });

  it('survives a storage read that returns something this module did not write', () => {
    localStorage.setItem(`${COMPOSER_DRAFT_STORAGE_PREFIX}convo-a`, 'not json at all');
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft('convo-a')).toBeNull();
    expect(localStorage.getItem(`${COMPOSER_DRAFT_STORAGE_PREFIX}convo-a`)).toBeNull();
  });

  it('survives a stored envelope whose draft field is the wrong type', () => {
    localStorage.setItem(`${COMPOSER_DRAFT_STORAGE_PREFIX}convo-a`, JSON.stringify({ v: 1, t: 1, d: 42 }));
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft('convo-a')).toBeNull();
  });

  it('keeps serving the in-memory draft when a later storage read fails', () => {
    writeCachedDraft('convo-a', 'already in memory');
    stubThrowingStorage();
    expect(readCachedDraft('convo-a')).toBe('already in memory');
  });
});
