import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createBrowserSessionStore } from '../session-store.js';
import type { SessionStoragePort, PersistedEmbedState } from '../session-store.js';
// Generalized characterization cases from the source transcript/action-queue tests.
const TRANSCRIPT_STORAGE_KEY = 'example.transcript.v1';
const ACTION_QUEUE_STORAGE_KEY = 'example.action-queue.v1';
function store(storage: SessionStoragePort) {
  return createBrowserSessionStore({ storage, transcriptKey: TRANSCRIPT_STORAGE_KEY,
    maxMessages: 50, maxBytes: 200_000,
    validateMessage: ({ value }) => {
      if (typeof value !== 'object' || value === null) return false;
      const m = value as Record<string, unknown>;
      return typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
    } });
}
const loadPersistedState = (storage: SessionStoragePort) => store(storage).load({});
const savePersistedState = (storage: SessionStoragePort, state: PersistedEmbedState) => store(storage).save({ state });
const clearPersistedState = (storage: SessionStoragePort) => store(storage).clear({});
class FakeStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function message(id: string, role: "user" | "assistant", content: string) {
  return { id, role, content };
}

describe("transcript-storage", () => {
  describe("loadPersistedState — fail-soft rehydrate", () => {
    it("returns the empty default when nothing is stored", () => {
      const storage = new FakeStorage();
      assert.deepEqual(loadPersistedState(storage), { open: false, messages: [] });
    });

    it("rehydrates a validly-shaped entry", () => {
      const storage = new FakeStorage();
      const state = { open: true, messages: [message("1", "user", "hi")] };
      storage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(state));
      assert.deepEqual(loadPersistedState(storage), state);
    });

    it("clears the key and starts empty on malformed JSON", () => {
      const storage = new FakeStorage();
      storage.setItem(TRANSCRIPT_STORAGE_KEY, "{not valid json");
      assert.deepEqual(loadPersistedState(storage), { open: false, messages: [] });
      assert.equal(storage.getItem(TRANSCRIPT_STORAGE_KEY), null, "the corrupt entry must be cleared, not left behind");
    });

    it("clears the key and starts empty when the envelope is not an object", () => {
      const storage = new FakeStorage();
      storage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(["not", "an", "object"]));
      assert.deepEqual(loadPersistedState(storage), { open: false, messages: [] });
      assert.equal(storage.getItem(TRANSCRIPT_STORAGE_KEY), null);
    });

    it("clears the key and starts empty when open is the wrong type", () => {
      const storage = new FakeStorage();
      storage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify({ open: "yes", messages: [] }));
      assert.deepEqual(loadPersistedState(storage), { open: false, messages: [] });
      assert.equal(storage.getItem(TRANSCRIPT_STORAGE_KEY), null);
    });

    it("clears the key and starts empty when messages is not an array", () => {
      const storage = new FakeStorage();
      storage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify({ open: true, messages: "nope" }));
      assert.deepEqual(loadPersistedState(storage), { open: false, messages: [] });
      assert.equal(storage.getItem(TRANSCRIPT_STORAGE_KEY), null);
    });

    it("clears the whole entry when a message's id is not a string", () => {
      const storage = new FakeStorage();
      const poisoned = { open: true, messages: [{ id: 42, role: "user", content: "fine" }] };
      storage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(poisoned));
      assert.deepEqual(loadPersistedState(storage), { open: false, messages: [] });
      assert.equal(storage.getItem(TRANSCRIPT_STORAGE_KEY), null);
    });

    it("clears the whole entry when a message's content is not a string", () => {
      const storage = new FakeStorage();
      const poisoned = { open: true, messages: [{ id: "1", role: "user", content: 42 }] };
      storage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(poisoned));
      assert.deepEqual(loadPersistedState(storage), { open: false, messages: [] });
      assert.equal(storage.getItem(TRANSCRIPT_STORAGE_KEY), null);
    });

    it("clears the whole entry when a message entry is not an object at all", () => {
      const storage = new FakeStorage();
      const poisoned = { open: true, messages: [message("1", "user", "fine"), "not an object"] };
      storage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(poisoned));
      assert.deepEqual(loadPersistedState(storage), { open: false, messages: [] });
      assert.equal(storage.getItem(TRANSCRIPT_STORAGE_KEY), null);
    });

    it("clears the whole entry when even one message in the array is wrong-shaped", () => {
      const storage = new FakeStorage();
      const poisoned = {
        open: true,
        messages: [message("1", "user", "fine"), { id: "2", role: "villain", content: "bad role" }],
      };
      storage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(poisoned));
      assert.deepEqual(
        loadPersistedState(storage),
        { open: false, messages: [] },
        "no partial recovery — one bad message clears the entire stored entry, not just itself",
      );
      assert.equal(storage.getItem(TRANSCRIPT_STORAGE_KEY), null);
    });

    it("never throws when storage access itself throws", () => {
      const throwing: Storage = {
        length: 0,
        clear: () => {},
        key: () => null,
        getItem: () => {
          throw new DOMException("blocked", "SecurityError");
        },
        removeItem: () => {},
        setItem: () => {},
      };
      assert.doesNotThrow(() => loadPersistedState(throwing));
      assert.deepEqual(loadPersistedState(throwing), { open: false, messages: [] });
    });
  });

  describe("savePersistedState — bounded, oldest-dropped-first", () => {
    it("round-trips through loadPersistedState", () => {
      const storage = new FakeStorage();
      const state = { open: true, messages: [message("1", "user", "hello"), message("2", "assistant", "hi there")] };
      savePersistedState(storage, state);
      assert.deepEqual(loadPersistedState(storage), state);
    });

    it("drops the oldest messages first once the count cap is exceeded", () => {
      const storage = new FakeStorage();
      const messages = Array.from({ length: 60 }, (_, i) => message(`${i}`, "user", `turn ${i}`));
      savePersistedState(storage, { open: false, messages });
      const reloaded = loadPersistedState(storage);
      assert.equal(reloaded.messages.length, 50, "capped at MAX_MESSAGES");
      assert.equal(reloaded.messages[0]?.id, "10", "the 10 oldest were dropped, not the newest");
      assert.equal(reloaded.messages.at(-1)?.id, "59");
    });

    it("drops oldest messages first once the byte cap is exceeded, even under the count cap", () => {
      const storage = new FakeStorage();
      const big = "x".repeat(20_000);
      const messages = Array.from({ length: 15 }, (_, i) => message(`${i}`, "assistant", big));
      savePersistedState(storage, { open: false, messages });
      const reloaded = loadPersistedState(storage);
      assert.ok(reloaded.messages.length < 15, "byte cap must trim before the 50-message count cap would ever trigger");
      assert.equal(reloaded.messages.at(-1)?.id, "14", "the newest survives; oldest are dropped first");
      assert.deepEqual(reloaded.messages, messages.slice(6));
      assert.ok(Buffer.byteLength(storage.getItem(TRANSCRIPT_STORAGE_KEY)!, "utf8") <= 200_000);
    });

    it("drops a single message larger than the byte cap while retaining pane state", () => {
      const storage = new FakeStorage();
      savePersistedState(storage, { open: true, messages: [message("huge", "assistant", "x".repeat(200_001))] });
      assert.deepEqual(JSON.parse(storage.getItem(TRANSCRIPT_STORAGE_KEY)!), { open: true, messages: [] });
      assert.deepEqual(loadPersistedState(storage), { open: true, messages: [] });
    });

    for (const [character, retained] of [["界", 3], ["🙂", 2]] as const) {
      it(`enforces the UTF-8 byte cap for ${character} transcripts`, () => {
        const storage = new FakeStorage();
        const messages = Array.from({ length: 5 }, (_, i) => message(`${i}`, "assistant", character.repeat(20_000)));
        savePersistedState(storage, { open: true, messages });
        assert.deepEqual(loadPersistedState(storage), { open: true, messages: messages.slice(5 - retained) });
        assert.ok(Buffer.byteLength(storage.getItem(TRANSCRIPT_STORAGE_KEY)!, "utf8") <= 200_000);
      });
    }

    it("never throws when the underlying setItem throws (e.g. quota exceeded)", () => {
      const throwing: Storage = {
        length: 0,
        clear: () => {},
        key: () => null,
        getItem: () => null,
        removeItem: () => {},
        setItem: () => {
          throw new DOMException("quota exceeded", "QuotaExceededError");
        },
      };
      assert.doesNotThrow(() => savePersistedState(throwing, { open: true, messages: [message("1", "user", "x")] }));
    });
  });

  describe("clearPersistedState", () => {
    it("removes the stored key", () => {
      const storage = new FakeStorage();
      savePersistedState(storage, { open: true, messages: [message("1", "user", "x")] });
      clearPersistedState(storage);
      assert.equal(storage.getItem(TRANSCRIPT_STORAGE_KEY), null);
      assert.deepEqual(loadPersistedState(storage), { open: false, messages: [] });
    });

    it("never throws when the underlying removeItem throws", () => {
      const throwing: Storage = {
        length: 0,
        clear: () => {},
        key: () => null,
        getItem: () => null,
        removeItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {},
      };
      assert.doesNotThrow(() => clearPersistedState(throwing));
    });
  });
});


describe('host configuration and failure boundaries', () => {
  const valid = ({ value }: { value: unknown }) => typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'string' && 'role' in value && (value.role === 'user' || value.role === 'assistant')
    && 'content' in value && typeof value.content === 'string';
  function configured(storage: SessionStoragePort, maxMessages = 2, maxBytes = 200_000) {
    return createBrowserSessionStore({ storage, transcriptKey: 'a', maxMessages, maxBytes, validateMessage: valid });
  }
  it('requires a nonempty key and finite limits', () => {
    const args = { storage: new FakeStorage(), transcriptKey: 'a', maxMessages: 2, maxBytes: 28, validateMessage: valid };
    assert.throws(() => createBrowserSessionStore({ ...args, transcriptKey: '' }), /nonempty/);
    for (const invalid of [-1, NaN, Infinity, 1.5]) {
      assert.throws(() => createBrowserSessionStore({ ...args, maxMessages: invalid }), /message limit/);
      assert.throws(() => createBrowserSessionStore({ ...args, maxBytes: invalid }), /byte limit/);
    }
    assert.throws(() => createBrowserSessionStore({ ...args, maxBytes: 27 }), /byte limit/);
  });
  it('a zero message limit retains pane state but drops every message', () => {
    const storage = new FakeStorage();
    const session = configured(storage, 0);
    session.save({ state: { open: true, messages: [message('u', 'user', 'hi')] } });
    assert.deepEqual(session.load({}), { open: true, messages: [] });
  });
  it('clears an oversized stored transcript before rehydration', () => {
    const storage = new FakeStorage();
    storage.setItem('a', JSON.stringify({ open: true, messages: [message('u', 'user', 'x'.repeat(300))] }));
    assert.deepEqual(configured(storage, 2, 100).load({}), { open: false, messages: [] });
    assert.equal(storage.getItem('a'), null);
    storage.setItem('a', JSON.stringify({ open: true, messages: [message('1', 'user', 'a'), message('2', 'user', 'b'), message('3', 'user', 'c')] }));
    assert.deepEqual(configured(storage).load({}), { open: false, messages: [] });
    assert.equal(storage.getItem('a'), null);
  });
  it('never throws when transcript serialization encounters circular data', () => {
    const storage = new FakeStorage();
    const session = configured(storage);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const m = { ...message('u', 'user', 'hi'), extra: circular };
    assert.doesNotThrow(() => session.save({ state: { open: true, messages: [m] } }));
    assert.equal(storage.getItem('a'), null);
    assert.equal(storage.getItem('b'), null);
  });
  it('returns fresh empty envelopes and keeps namespaces isolated', () => {
    const storage = new FakeStorage();
    const first = configured(storage);
    first.load({}).messages.push(message('mutated', 'user', 'hi'));
    assert.deepEqual(first.load({}), { open: false, messages: [] });
    const second = createBrowserSessionStore({ storage, transcriptKey: 'other.a', maxMessages: 2, maxBytes: 1000, validateMessage: valid });
    first.save({ state: { open: true, messages: [message('u', 'user', 'hi')] } });
    assert.deepEqual(second.load({}), { open: false, messages: [] });
  });
});
