/**
 * @module last-conversation-store
 *
 * Remembers which conversation an operator last had open, so a host's chat surface can land back
 * on it after a page reload, a closed tab, or a navigation away — instead of an empty new chat.
 *
 * Conversation SELECTION is host-owned (`ChatPane` is uncontrolled and takes a `conversationId`;
 * `ConversationList` takes `activeConversationId` as a prop), so this module does not decide when
 * to restore. It is only the durable slot: the host reads it once at mount, checks the id still
 * exists for this caller, and writes it whenever its active conversation changes.
 *
 * Same storage discipline as `composer-draft-cache.ts`: a versioned key, every access wrapped, and a
 * foreign or corrupt entry treated as "nothing remembered" and deleted. A private window, blocked
 * site data or a quota rejection degrades this to remembering nothing — never a throw at the host.
 *
 * Unlike the draft cache this is NOT a module singleton. The partition here is the caller's
 * identity (`scope`), which only the host knows — two users on one browser must never land in each
 * other's chat — so a host constructs one store per scope and passes it down.
 */

/**
 * Key prefix for the stored entry. Versioned (`.v1.`) so a future change to the stored shape can be
 * introduced without interpreting, or mis-interpreting, entries written by this one.
 */
export const LAST_CONVERSATION_STORAGE_PREFIX = 'jini.chat.last-conversation.v1.';

/** The subset of Web Storage this module uses — `localStorage` satisfies it; tests pass a fake. */
export interface LastConversationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The host-facing port. Every method is total: none throws, whatever storage does. */
export interface LastConversationStore {
  /** The remembered conversation id, or `null` when there is none or storage is unusable. */
  read(): string | null;
  /** Remembers `conversationId` as the one to land on next time, replacing any earlier one. */
  write(conversationId: string): void;
  /** Forgets the remembered id — for a conversation that was deleted or is no longer reachable. */
  clear(): void;
}

/** The stored shape. */
interface StoredLastConversation {
  readonly v: 1;
  readonly id: string;
}

/**
 * The origin's `localStorage`, or `null` when it cannot be used — a non-browser runtime, or a
 * browser that throws on the property access itself (Safari and Chrome both do with site data
 * blocked), which is why this is a try/catch rather than a `typeof` check alone.
 * @complexity Time/space: O(1).
 */
function browserStorage(): LastConversationStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Validates one parsed entry as this module's own envelope.
 * @complexity Time/space: O(1).
 */
function storedId(parsed: unknown): string | null {
  const entry = parsed as Partial<StoredLastConversation> | null;
  if (entry?.v !== 1 || typeof entry.id !== 'string' || entry.id === '') return null;
  return entry.id;
}

/**
 * Creates the last-conversation slot for one caller identity.
 *
 * @param required.scope Who this memory belongs to — e.g. `${workspaceId}:${userId}`. Part of the
 *   key, so a different scope on the same browser reads nothing.
 * @param optional.storage Defaults to the origin's `localStorage`, resolved on every call (not once)
 *   so a store created during SSR still works after hydration. `null` disables persistence.
 * @returns A {@link LastConversationStore}; see its methods for the never-throws contract.
 * @example
 * const store = createLastConversationStore({ scope: `${workspaceId}:${user.id}` });
 * const id = store.read(); // land here if it still exists, else store.clear()
 * @complexity Time/space: O(1) per call, plus O(n) in the entry's length for the JSON parse.
 */
export function createLastConversationStore(
  { scope }: { scope: string },
  { storage }: { storage?: LastConversationStorage | null } = {},
): LastConversationStore {
  const key = `${LAST_CONVERSATION_STORAGE_PREFIX}${encodeURIComponent(scope)}`;
  const resolve = (): LastConversationStorage | null => (storage === undefined ? browserStorage() : storage);
  const remove = (store: LastConversationStorage): void => {
    try {
      store.removeItem(key);
    } catch {
      /* storage is unusable; nothing further this module can do */
    }
  };
  return {
    read() {
      const store = resolve();
      if (!store) return null;
      try {
        const raw = store.getItem(key);
        if (raw === null) return null;
        const id = storedId(JSON.parse(raw));
        if (id === null) remove(store);
        return id;
      } catch {
        // A parse failure or a throwing read: a corrupt entry must not survive to be read again.
        remove(store);
        return null;
      }
    },
    write(conversationId) {
      const store = resolve();
      if (!store) return;
      try {
        const envelope: StoredLastConversation = { v: 1, id: conversationId };
        store.setItem(key, JSON.stringify(envelope));
      } catch {
        /* blocked, full, or unusable storage — remembering nothing is the documented degraded mode */
      }
    },
    clear() {
      const store = resolve();
      if (store) remove(store);
    },
  };
}
