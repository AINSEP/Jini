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
}
/** Which step failed: storage read, envelope decode (the entry is cleared first), serialization,
 *  storage write, or storage remove. */
export type BrowserSessionStoreOperation = 'load' | 'decode' | 'serialize' | 'save' | 'clear';
export interface BrowserSessionStoreArgs {
  readonly storage: SessionStoragePort;
  readonly transcriptKey: string;
  readonly maxMessages: number;
  readonly maxBytes: number;
  readonly validateMessage: (args: { value: unknown }) => boolean;
  /**
   * What `load` does with a stored envelope over `maxMessages`/`maxBytes`. `'clear'` (default) treats
   * it as corrupt. `'read'` rehydrates it whole, for a host whose earlier releases never capped reads:
   * a visitor's existing transcript must survive the upgrade. Writes stay capped either way.
   */
  readonly overCapReads?: 'clear' | 'read';
  /**
   * Receives every swallowed failure. Default: none, so the store stays silent. It runs inside the
   * store's failure path and a throw from it escapes the call, so a host may keep a failure loud.
   */
  readonly onFailure?: (failure: { operation: BrowserSessionStoreOperation; error: unknown }) => void;
}

/**
 * Creates bounded, fail-soft transcript storage.
 * Corrupt transcripts are cleared as a whole. Serialization/storage failures never escape unless
 * the host's `onFailure` rethrows; by default they are swallowed silently.
 * Reject oversized stored envelopes before parsing, validate the whole message batch, then trim
 * oldest messages first. Circular serialization is fail-soft. Keys, limits, validator and Storage
 * are injected so separate controllers never accidentally share a product-selected namespace.
 * @complexity Load O(bytes + messages); save O(messages * serialized bytes) in the
 * worst trimming case. State is instance-local.
 */
export function createBrowserSessionStore(args: BrowserSessionStoreArgs): BrowserSessionStore {
  const { storage, transcriptKey, maxMessages, maxBytes, validateMessage } = args;
  const capReads = args.overCapReads !== 'read';
  const report = args.onFailure ?? (() => undefined);
  if (!transcriptKey) {
    throw new Error('Transcript key must be nonempty');
  }
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 0) throw new Error('Invalid message limit');
  // The smallest envelope (open=false) is 28 UTF-8 bytes.
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 28) throw new Error('Invalid byte limit');
  const empty = (): PersistedEmbedState => ({ open: false, messages: [] });
  const clear = (_args: Record<string, never>): void => {
    try { storage.removeItem(transcriptKey); } catch (error) { report({ operation: 'clear', error }); } // unavailable storage
  };
  return {
    load(_args) {
      let raw: string | null;
      try { raw = storage.getItem(transcriptKey); } catch (error) { report({ operation: 'load', error }); return empty(); }
      if (raw === null) return empty();
      try {
        return parseTranscript({ raw, maxBytes, maxMessages, validateMessage, capReads });
      } catch (error) { clear({}); report({ operation: 'decode', error }); return empty(); }
    },
    save({ state }) {
      // The live conversation continues even when serialization or storage fails.
      let serialized: string;
      try { serialized = serializeCapped({ state, maxBytes, maxMessages }); } catch (error) { report({ operation: 'serialize', error }); return; }
      try { storage.setItem(transcriptKey, serialized); } catch (error) { report({ operation: 'save', error }); }
    },
    clear,

  };
}

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

/** Drops the oldest messages first until both the count cap and the UTF-8 byte cap hold. */
function serializeCapped(args: { state: PersistedEmbedState; maxBytes: number; maxMessages: number }): string {
  const { state, maxBytes, maxMessages } = args;
  let messages = maxMessages === 0 ? [] : state.messages.slice(-maxMessages);
  let serialized = JSON.stringify({ open: state.open, messages });
  while (messages.length > 0 && utf8Bytes(serialized) > maxBytes) {
    messages = messages.slice(1);
    serialized = JSON.stringify({ open: state.open, messages });
  }
  return serialized;
}

interface ParseTranscriptArgs extends Pick<BrowserSessionStoreArgs, 'maxBytes' | 'maxMessages' | 'validateMessage'> {
  readonly raw: string;
  /** False only under `overCapReads: 'read'`: a legacy over-cap envelope is still validated, not size-checked. */
  readonly capReads: boolean;
}

/**
 * Parses and validates one stored transcript envelope. Throws on any defect so the caller can
 * clear the whole entry (no partial recovery). Oversized envelopes are rejected before parsing
 * unless the host opted into reading legacy over-cap envelopes.
 */
function parseTranscript(args: ParseTranscriptArgs): PersistedEmbedState {
  const { raw, maxBytes, maxMessages, validateMessage, capReads } = args;
  if (capReads && utf8Bytes(raw) > maxBytes) throw new Error('Transcript exceeds byte limit');
  const state = parseEnvelopeShape(raw);
  if (capReads && state.messages.length > maxMessages) throw new Error('Transcript exceeds message limit');
  if (!state.messages.every(value => validateMessage({ value }))) throw new Error('Invalid transcript');
  return { open: state.open, messages: state.messages as ChatMessage[] };
}

/** JSON-parses the envelope and checks only its `{ open: boolean, messages: unknown[] }` shape; throws on any defect. */
function parseEnvelopeShape(raw: string): { open: boolean; messages: unknown[] } {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid envelope');
  const state = value as Record<string, unknown>;
  if (typeof state.open !== 'boolean' || !Array.isArray(state.messages)) throw new Error('Invalid transcript');
  return { open: state.open, messages: state.messages };
}
