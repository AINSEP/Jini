import type { ChatMessage } from '../../core/messages.js';

/** Host-owned per-tab storage. No browser global or storage backend is selected here. */
export interface SessionStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface PersistedEmbedState {
  readonly open: boolean;
  readonly messages: ChatMessage[];
}
export interface BrowserSessionStore {
  load(args: Record<string, never>): PersistedEmbedState;
  save(args: { state: PersistedEmbedState }): void;
  clear(args: Record<string, never>): void;
  enqueue(args: { action: unknown }): void;
  drain(args: Record<string, never>): unknown | null;
}
export interface BrowserSessionStoreArgs {
  readonly storage: SessionStoragePort;
  readonly transcriptKey: string;
  readonly actionKey: string;
  readonly maxMessages: number;
  readonly maxBytes: number;
  readonly validateMessage: (args: { value: unknown }) => boolean;
}

/**
 * Creates bounded, fail-soft transcript storage and a single-slot action queue.
 * Corrupt transcripts are cleared as a whole. Actions are deleted before delivery,
 * and a failed delete prevents delivery. Serialization/storage failures never escape.
 * Reject oversized stored envelopes before parsing, validate the whole message batch, then trim
 * oldest messages first. Circular serialization is fail-soft. Keys, limits, validator and Storage
 * are injected so separate controllers never accidentally share a product-selected namespace.
 * @complexity Load O(bytes + messages); save O(messages * serialized bytes) in the
 * worst trimming case; queue O(serialized action bytes). State is instance-local.
 */
export function createBrowserSessionStore(args: BrowserSessionStoreArgs): BrowserSessionStore {
  const { storage, transcriptKey, actionKey, maxMessages, maxBytes, validateMessage } = args;
  if (!transcriptKey || !actionKey || transcriptKey === actionKey) {
    throw new Error('Transcript and action keys must be nonempty and distinct');
  }
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 0) throw new Error('Invalid message limit');
  // The smallest envelope (open=false) is 28 UTF-8 bytes.
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 28) throw new Error('Invalid byte limit');
  const empty = (): PersistedEmbedState => ({ open: false, messages: [] });
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  const clear = (_args: Record<string, never>): void => {
    try { storage.removeItem(transcriptKey); } catch { /* unavailable storage */ }
  };
  return {
    load(_args) {
      let raw: string | null;
      try { raw = storage.getItem(transcriptKey); } catch { return empty(); }
      if (raw === null) return empty();
      try {
        if (bytes(raw) > maxBytes) throw new Error('Transcript exceeds byte limit');
        const value: unknown = JSON.parse(raw);
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid envelope');
        const state = value as Record<string, unknown>;
        if (typeof state.open !== 'boolean' || !Array.isArray(state.messages)
          || state.messages.length > maxMessages || !state.messages.every(value => validateMessage({ value }))) throw new Error('Invalid transcript');
        return { open: state.open, messages: state.messages as ChatMessage[] };
      } catch { clear({}); return empty(); }
    },
    save({ state }) {
      try {
        let messages = maxMessages === 0 ? [] : state.messages.slice(-maxMessages);
        let serialized = JSON.stringify({ open: state.open, messages });
        while (messages.length > 0 && bytes(serialized) > maxBytes) {
          messages = messages.slice(1);
          serialized = JSON.stringify({ open: state.open, messages });
        }
        storage.setItem(transcriptKey, serialized);
      } catch { /* The live conversation continues even when serialization or storage fails. */ }
    },
    clear,
    enqueue({ action }) {
      try {
        const serialized = JSON.stringify(action);
        if (serialized !== undefined) storage.setItem(actionKey, serialized);
      } catch { /* The live page continues without a queued action. */ }
    },
    drain(_args) {
      let raw: string | null;
      try { raw = storage.getItem(actionKey); } catch { return null; }
      if (raw === null) return null;
      try { storage.removeItem(actionKey); } catch { return null; }
      try { return JSON.parse(raw) as unknown; } catch { return null; }
    },
  };
}
