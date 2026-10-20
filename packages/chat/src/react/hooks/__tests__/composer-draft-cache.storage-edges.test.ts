/**
 * @file Edge cases of `composer-draft-cache`'s storage tier: an absent or inaccessible
 * `localStorage`, partially-failing storage (quota, a removeItem that throws), malformed stored
 * attachment entries, and the attachment tier's own cap. The happy paths live in
 * `composer-draft-cache.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment } from '../../../core/index.js';
import {
  __resetComposerDraftCacheForTests,
  clearCachedDraft,
  COMPOSER_ATTACHMENTS_STORAGE_PREFIX,
  COMPOSER_DRAFT_STORAGE_PREFIX,
  MAX_CACHED_CONVERSATION_DRAFTS,
  readCachedAttachmentBatchId,
  readCachedAttachments,
  readCachedDraft,
  rememberCachedDraft,
  writeCachedAttachmentBatchId,
  writeCachedAttachments,
  writeCachedDraft,
} from '../composer-draft-cache.js';

type StorageMethod = 'getItem' | 'setItem' | 'removeItem';

/** A working in-memory `Storage` whose named methods can be made to throw. */
class FakeStorage implements Storage {
  [name: string]: unknown;
  readonly #items = new Map<string, string>();
  readonly #failing: ReadonlySet<StorageMethod>;

  constructor({ failing = [] }: { failing?: StorageMethod[] } = {}) {
    this.#failing = new Set(failing);
  }

  #guard(method: StorageMethod): void {
    if (this.#failing.has(method)) throw new Error(`fake storage: ${method} refused`);
  }

  get length(): number {
    return this.#items.size;
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    this.#guard('getItem');
    return this.#items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#guard('setItem');
    this.#items.set(key, value);
  }

  removeItem(key: string): void {
    this.#guard('removeItem');
    this.#items.delete(key);
  }

  clear(): void {
    this.#items.clear();
  }

  /** Seeds an entry regardless of which methods are failing. */
  seed(key: string, value: string): void {
    this.#items.set(key, value);
  }

  has(key: string): boolean {
    return this.#items.has(key);
  }
}

const IMAGE: ChatAttachment = { path: '/uploads/b1/a.png', name: 'a.png', kind: 'image' };
const FILE: ChatAttachment = { path: '/uploads/b1/notes.txt', name: 'notes.txt', kind: 'file', size: 12, order: 1 };
const draftKey = (id: string) => `${COMPOSER_DRAFT_STORAGE_PREFIX}${id}`;
const attachmentsKey = (id: string) => `${COMPOSER_ATTACHMENTS_STORAGE_PREFIX}${id}`;

function useStorage(store: FakeStorage): FakeStorage {
  vi.stubGlobal('localStorage', store);
  return store;
}

beforeEach(() => __resetComposerDraftCacheForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  __resetComposerDraftCacheForTests();
});

describe('composer-draft-cache with no localStorage at all (non-browser runtime)', () => {
  beforeEach(() => vi.stubGlobal('localStorage', undefined));

  it('keeps drafts in memory and reports nothing stored after a reload', () => {
    writeCachedDraft({ conversationId: 'c', draft: 'typed' });
    expect(readCachedDraft({ conversationId: 'c' })).toBe('typed');
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedDraft({ conversationId: 'c' })).toBeNull();
  });

  it('keeps attachments in memory and reports nothing stored after a reload', () => {
    writeCachedAttachments({ conversationId: 'c', attachments: [IMAGE] });
    expect(readCachedAttachments({ conversationId: 'c' })).toEqual([IMAGE]);
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect(readCachedAttachments({ conversationId: 'c' })).toBeNull();
  });

  it('clears and resets without throwing', () => {
    writeCachedAttachments({ conversationId: 'c', attachments: [IMAGE] });
    clearCachedDraft({ conversationId: 'c' });
    expect(readCachedAttachments({ conversationId: 'c' })).toBeNull();
    expect(() => __resetComposerDraftCacheForTests()).not.toThrow();
  });
});

describe('composer-draft-cache when reading the localStorage property itself throws', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: site data is blocked');
      },
    });
  });

  it('degrades to memory-only for drafts and attachments', () => {
    writeCachedDraft({ conversationId: 'c', draft: 'typed' });
    writeCachedAttachments({ conversationId: 'c', attachments: [IMAGE] });
    __resetComposerDraftCacheForTests({ keepStorage: true });
    expect([readCachedDraft({ conversationId: 'c' }), readCachedAttachments({ conversationId: 'c' })]).toEqual([null, null]);
  });
});

describe('rememberCachedDraft (memory tier only)', () => {
  it('keeps the draft in memory without writing storage', () => {
    const store = useStorage(new FakeStorage());
    rememberCachedDraft({ conversationId: 'c', draft: 'per keystroke' });
    expect(readCachedDraft({ conversationId: 'c' })).toBe('per keystroke');
    expect(store.has(draftKey('c'))).toBe(false);
  });

  it('deletes the in-memory entry for a whitespace-only draft, leaving storage alone', () => {
    const store = useStorage(new FakeStorage());
    writeCachedDraft({ conversationId: 'c', draft: 'durable' });
    rememberCachedDraft({ conversationId: 'c', draft: '  ' });
    expect(store.has(draftKey('c'))).toBe(true);
    // Memory is empty, so the read falls through to the still-stored copy.
    expect(readCachedDraft({ conversationId: 'c' })).toBe('durable');
  });

  it('is a no-op without a conversation id', () => {
    rememberCachedDraft({ conversationId: null, draft: 'x' });
    rememberCachedDraft({ conversationId: undefined, draft: 'x' });
    expect(readCachedDraft({ conversationId: 'null' })).toBeNull();
  });
});

describe('composer-draft-cache storage writes that fail part-way', () => {
  it('keeps a draft in memory when setItem rejects (quota)', () => {
    const store = useStorage(new FakeStorage({ failing: ['setItem'] }));
    writeCachedDraft({ conversationId: 'c', draft: 'over quota' });
    expect([readCachedDraft({ conversationId: 'c' }), store.has(draftKey('c'))]).toEqual(['over quota', false]);
  });

  it('keeps attachments in memory when setItem rejects (quota)', () => {
    const store = useStorage(new FakeStorage({ failing: ['setItem'] }));
    writeCachedAttachments({ conversationId: 'c', attachments: [IMAGE] });
    expect([readCachedAttachments({ conversationId: 'c' }), store.has(attachmentsKey('c'))]).toEqual([[IMAGE], false]);
  });

  it('resurrects cleared attachments from storage when removeItem throws (reported, not fixed)', () => {
    // The memory tier is cleared, so the next read falls through to the entry removeItem failed to delete.
    const store = useStorage(new FakeStorage({ failing: ['removeItem'] }));
    writeCachedAttachments({ conversationId: 'c', attachments: [IMAGE] });
    writeCachedAttachments({ conversationId: 'c', attachments: [] });
    expect(store.has(attachmentsKey('c'))).toBe(true);
    expect(readCachedAttachments({ conversationId: 'c' })).toEqual([IMAGE]);
  });

  it('leaves a corrupt draft entry behind and returns null when removeItem also throws', () => {
    const store = useStorage(new FakeStorage({ failing: ['removeItem'] }));
    store.seed(draftKey('c'), '{not json');
    expect(readCachedDraft({ conversationId: 'c' })).toBeNull();
    expect(store.has(draftKey('c'))).toBe(true);
  });

  it('leaves a corrupt attachments entry behind and returns null when removeItem also throws', () => {
    const store = useStorage(new FakeStorage({ failing: ['removeItem'] }));
    store.seed(attachmentsKey('c'), '{not json');
    expect(readCachedAttachments({ conversationId: 'c' })).toBeNull();
    expect(store.has(attachmentsKey('c'))).toBe(true);
  });

  it('does not throw from the test reset when storage enumeration fails', () => {
    useStorage(new FakeStorage({ failing: ['getItem', 'removeItem'] })).seed(draftKey('c'), 'x');
    expect(() => __resetComposerDraftCacheForTests()).not.toThrow();
  });
});

describe('composer-draft-cache stored draft validation', () => {
  it('deletes a stored envelope holding an empty draft rather than restoring it', () => {
    const store = useStorage(new FakeStorage());
    store.seed(draftKey('c'), JSON.stringify({ v: 1, t: 1, d: '' }));
    expect([readCachedDraft({ conversationId: 'c' }), store.has(draftKey('c'))]).toEqual([null, false]);
  });

  it('deletes a stored entry that is JSON null', () => {
    const store = useStorage(new FakeStorage());
    store.seed(draftKey('c'), 'null');
    expect([readCachedDraft({ conversationId: 'c' }), store.has(draftKey('c'))]).toEqual([null, false]);
  });
});

describe('composer-draft-cache stored attachment validation', () => {
  function readSeeded(value: unknown): { result: readonly ChatAttachment[] | null; kept: boolean } {
    const store = useStorage(new FakeStorage());
    store.seed(attachmentsKey('c'), typeof value === 'string' ? value : JSON.stringify(value));
    const result = readCachedAttachments({ conversationId: 'c' });
    return { result, kept: store.has(attachmentsKey('c')) };
  }

  it('restores valid references, including optional size and order', () => {
    expect(readSeeded({ v: 1, t: 1, a: [IMAGE, FILE] })).toEqual({ result: [IMAGE, FILE], kept: true });
  });

  it('deletes an entry that is not JSON', () => {
    expect(readSeeded('{oops')).toEqual({ result: null, kept: false });
  });

  it('deletes an entry that is JSON null', () => {
    expect(readSeeded(null)).toEqual({ result: null, kept: false });
  });

  it('deletes an entry whose list is not an array', () => {
    expect(readSeeded({ v: 1, t: 1, a: 'nope' })).toEqual({ result: null, kept: false });
  });

  it('deletes an entry in which no element validates', () => {
    expect(readSeeded({ v: 1, t: 1, a: [null, 7] })).toEqual({ result: null, kept: false });
  });

  it.each([
    ['a non-object', 'string'],
    ['null', null],
    ['a missing path', { name: 'a', kind: 'file' }],
    ['an empty path', { path: '', name: 'a', kind: 'file' }],
    ['a non-string name', { path: '/p', name: 3, kind: 'file' }],
    ['an unknown kind', { path: '/p', name: 'a', kind: 'video' }],
    ['a non-number size', { path: '/p', name: 'a', kind: 'file', size: '12' }],
    ['a non-number order', { path: '/p', name: 'a', kind: 'image', order: '1' }],
  ])('drops an element with %s but keeps the valid ones', (_label, bad) => {
    expect(readSeeded({ v: 1, t: 1, a: [bad, IMAGE] })).toEqual({ result: [IMAGE], kept: true });
  });

  it('returns null without a conversation id', () => {
    expect(readCachedAttachments({ conversationId: null })).toBeNull();
    expect(readCachedAttachments({ conversationId: undefined })).toBeNull();
  });

  it('promotes a stored hit into memory so later storage failures do not lose it', () => {
    const store = useStorage(new FakeStorage());
    store.seed(attachmentsKey('c'), JSON.stringify({ v: 1, t: 1, a: [IMAGE], b: 'batch-9' }));
    expect(readCachedAttachments({ conversationId: 'c' })).toEqual([IMAGE]);
    useStorage(new FakeStorage({ failing: ['getItem'] }));
    expect(readCachedAttachments({ conversationId: 'c' })).toEqual([IMAGE]);
    expect(readCachedAttachmentBatchId({ conversationId: 'c' })).toBe('batch-9');
  });
});

describe('composer-draft-cache attachment writes', () => {
  it('is a no-op without a conversation id', () => {
    const store = useStorage(new FakeStorage());
    writeCachedAttachments({ conversationId: null, attachments: [IMAGE] });
    writeCachedAttachments({ conversationId: undefined, attachments: [IMAGE] });
    expect(store.length).toBe(0);
  });

  it('stores the envelope with the recorded batch id and a write timestamp', () => {
    const store = useStorage(new FakeStorage());
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    writeCachedAttachmentBatchId({ conversationId: 'c', batchId: 'b1' });
    writeCachedAttachments({ conversationId: 'c', attachments: [IMAGE] });
    vi.restoreAllMocks();
    expect(JSON.parse(store.getItem(attachmentsKey('c'))!)).toEqual({ v: 1, t: 1234, a: [IMAGE], b: 'b1' });
  });

  it('stores the draft envelope with a write timestamp', () => {
    const store = useStorage(new FakeStorage());
    vi.spyOn(Date, 'now').mockReturnValue(99);
    writeCachedDraft({ conversationId: 'c', draft: 'hi' });
    vi.restoreAllMocks();
    expect(JSON.parse(store.getItem(draftKey('c'))!)).toEqual({ v: 1, t: 99, d: 'hi' });
  });

  it('evicts the oldest in-memory attachment list once the cap is exceeded', () => {
    vi.stubGlobal('localStorage', undefined);
    for (let i = 0; i <= MAX_CACHED_CONVERSATION_DRAFTS; i += 1) {
      writeCachedAttachments({ conversationId: `c-${i}`, attachments: [IMAGE] });
    }
    expect(readCachedAttachments({ conversationId: 'c-0' })).toBeNull();
    expect(readCachedAttachments({ conversationId: 'c-1' })).toEqual([IMAGE]);
  });

  it('does not evict when re-writing a tracked conversation at the cap', () => {
    vi.stubGlobal('localStorage', undefined);
    for (let i = 0; i < MAX_CACHED_CONVERSATION_DRAFTS; i += 1) {
      writeCachedAttachments({ conversationId: `c-${i}`, attachments: [IMAGE] });
    }
    writeCachedAttachments({ conversationId: 'c-0', attachments: [FILE] });
    expect(readCachedAttachments({ conversationId: 'c-0' })).toEqual([FILE]);
    expect(readCachedAttachments({ conversationId: 'c-1' })).toEqual([IMAGE]);
  });
});

describe('composer-draft-cache storage pruning', () => {
  it('prunes corrupt and timestamp-less entries first, ignoring other keys', () => {
    const store = useStorage(new FakeStorage());
    store.seed('unrelated.key', 'keep me');
    store.seed(draftKey('corrupt'), '{oops');
    store.seed(draftKey('no-ts'), JSON.stringify({ v: 1, d: 'old' }));
    store.seed(draftKey('null'), 'null');
    for (let i = 0; i < MAX_CACHED_CONVERSATION_DRAFTS - 1; i += 1) {
      store.seed(draftKey(`k-${i}`), JSON.stringify({ v: 1, t: 1000 + i, d: `d${i}` }));
    }
    writeCachedDraft({ conversationId: 'fresh', draft: 'new one' });
    expect(['corrupt', 'no-ts', 'null', 'k-0', 'k-1', 'fresh'].map((id) => store.has(draftKey(id)))).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(store.has('unrelated.key')).toBe(true);
  });

  it('prunes the oldest-timestamped stored attachment entry at the cap', () => {
    const store = useStorage(new FakeStorage());
    for (let i = 0; i < MAX_CACHED_CONVERSATION_DRAFTS; i += 1) {
      store.seed(attachmentsKey(`k-${i}`), JSON.stringify({ v: 1, t: 5000 - i, a: [IMAGE] }));
    }
    writeCachedAttachments({ conversationId: 'fresh', attachments: [IMAGE] });
    const newest = `k-${MAX_CACHED_CONVERSATION_DRAFTS - 1}`;
    expect([store.has(attachmentsKey(newest)), store.has(attachmentsKey('k-0')), store.has(attachmentsKey('fresh'))]).toEqual([false, true, true]);
  });

  it('does not prune when overwriting an already-stored key at the cap', () => {
    const store = useStorage(new FakeStorage());
    for (let i = 0; i < MAX_CACHED_CONVERSATION_DRAFTS; i += 1) {
      store.seed(draftKey(`k-${i}`), JSON.stringify({ v: 1, t: i, d: `d${i}` }));
    }
    writeCachedDraft({ conversationId: 'k-5', draft: 'edited' });
    expect(store.length).toBe(MAX_CACHED_CONVERSATION_DRAFTS);
  });
});
