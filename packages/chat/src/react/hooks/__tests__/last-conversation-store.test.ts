import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLastConversationStore,
  LAST_CONVERSATION_STORAGE_PREFIX,
  type LastConversationStorage,
} from '../last-conversation-store.js';

/** An in-memory {@link LastConversationStorage}; `failing` makes every call throw, like Safari with site data blocked. */
function fakeStorage(options: { failing?: boolean } = {}): LastConversationStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  const guard = () => {
    if (options.failing) throw new Error('SecurityError: storage is blocked');
  };
  return {
    items,
    getItem: (key) => {
      guard();
      return items.get(key) ?? null;
    },
    setItem: (key, value) => {
      guard();
      items.set(key, value);
    },
    removeItem: (key) => {
      guard();
      items.delete(key);
    },
  };
}

describe('last-conversation-store', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when nothing was remembered for the scope', () => {
    const store = createLastConversationStore({ scope: 'ws:user-1' }, { storage: fakeStorage() });
    expect(store.read()).toBeNull();
  });

  it('round-trips the remembered conversation id under a versioned, scope-keyed entry', () => {
    const storage = fakeStorage();
    const store = createLastConversationStore({ scope: 'ws:user-1' }, { storage });
    store.write('conv-42');
    expect(store.read()).toBe('conv-42');
    expect([...storage.items.keys()]).toEqual([`${LAST_CONVERSATION_STORAGE_PREFIX}ws%3Auser-1`]);
    expect(JSON.parse(storage.items.get(`${LAST_CONVERSATION_STORAGE_PREFIX}ws%3Auser-1`) ?? '')).toEqual({ v: 1, id: 'conv-42' });
  });

  it('keeps scopes apart, so another user on the same browser never reads this one', () => {
    const storage = fakeStorage();
    createLastConversationStore({ scope: 'ws:user-1' }, { storage }).write('conv-mine');
    expect(createLastConversationStore({ scope: 'ws:user-2' }, { storage }).read()).toBeNull();
    expect(createLastConversationStore({ scope: 'ws:user-1' }, { storage }).read()).toBe('conv-mine');
  });

  it('clear removes the entry', () => {
    const storage = fakeStorage();
    const store = createLastConversationStore({ scope: 'ws:user-1' }, { storage });
    store.write('conv-42');
    store.clear();
    expect(store.read()).toBeNull();
    expect(storage.items.size).toBe(0);
  });

  it('a later write replaces the earlier one', () => {
    const store = createLastConversationStore({ scope: 'ws:user-1' }, { storage: fakeStorage() });
    store.write('conv-1');
    store.write('conv-2');
    expect(store.read()).toBe('conv-2');
  });

  it('treats a foreign or corrupt entry as nothing remembered, and deletes it', () => {
    const storage = fakeStorage();
    const key = `${LAST_CONVERSATION_STORAGE_PREFIX}ws%3Auser-1`;
    const store = createLastConversationStore({ scope: 'ws:user-1' }, { storage });
    for (const raw of ['not json', '{"v":2,"id":"conv-1"}', '{"v":1,"id":""}', '{"v":1,"id":7}', 'null']) {
      storage.items.set(key, raw);
      expect(store.read()).toBeNull();
      expect(storage.items.has(key)).toBe(false);
    }
  });

  it('never throws when storage itself throws — it degrades to remembering nothing', () => {
    const store = createLastConversationStore({ scope: 'ws:user-1' }, { storage: fakeStorage({ failing: true }) });
    expect(() => store.write('conv-1')).not.toThrow();
    expect(store.read()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it('remembers nothing when storage is explicitly unavailable (null)', () => {
    const store = createLastConversationStore({ scope: 'ws:user-1' }, { storage: null });
    store.write('conv-1');
    expect(store.read()).toBeNull();
  });

  it('defaults to the origin localStorage when no storage is injected', () => {
    const store = createLastConversationStore({ scope: 'ws:user-1' });
    store.write('conv-9');
    expect(localStorage.getItem(`${LAST_CONVERSATION_STORAGE_PREFIX}ws%3Auser-1`)).toBe('{"v":1,"id":"conv-9"}');
    expect(createLastConversationStore({ scope: 'ws:user-1' }).read()).toBe('conv-9');
  });
});
