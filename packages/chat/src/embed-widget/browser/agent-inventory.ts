/**
 * @file Last-known agent inventory as an instant placeholder.
 *
 * A host that lists agents from a slow source (a cold daemon re-probing installed CLIs) can show the
 * last live answer this browser saw instead of an empty picker, and swap it for the live list the
 * moment that resolves. The last live answer is the same machine's own probe result, usually still
 * exact, whereas a list bundled into the client would be a hand-maintained duplicate of the server's
 * registry that drifts.
 *
 * Every storage access is fail-soft: browser storage throws in some privacy modes and on quota
 * exhaustion, and a missing placeholder only costs the host's normal loading state.
 */
import type { SessionStoragePort } from './session-store.js';

/** The fields a stored entry must carry to be trusted; hosts may store richer entries. */
export interface AgentInventoryEntry {
  readonly id: string;
  readonly name: string;
}

export interface AgentInventorySnapshot<T extends AgentInventoryEntry> {
  /** The last stored inventory, or `undefined` when there is none, it is empty, or it is unreadable. */
  read(args: Record<string, never>): readonly T[] | undefined;
  /** Stores a live inventory. An empty list is not stored: it would replace a useful placeholder with
   * one that shows nothing. Silent no-op on any storage failure. */
  write(args: { agents: readonly T[] }): void;
}

export interface AgentInventorySnapshotArgs {
  readonly storage: Pick<SessionStoragePort, 'getItem' | 'setItem'>;
  /** Version the key so a later change to the stored shape ignores old entries instead of misreading them. */
  readonly key: string;
}

function isEntryShape(value: unknown): value is AgentInventoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { id?: unknown; name?: unknown };
  return typeof candidate.id === 'string' && typeof candidate.name === 'string';
}

/** @complexity read/write O(n) in stored agents. */
export function createAgentInventorySnapshot<T extends AgentInventoryEntry>(
  { storage, key }: AgentInventorySnapshotArgs,
  _optional: { readonly [K in never]?: never } = {},
): AgentInventorySnapshot<T> {
  return {
    read: () => {
      try {
        const raw = storage.getItem(key);
        if (!raw) return undefined;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isEntryShape)) return undefined;
        return parsed as T[];
      } catch {
        return undefined;
      }
    },
    write: ({ agents }) => {
      if (agents.length === 0) return;
      try {
        storage.setItem(key, JSON.stringify(agents));
      } catch {
        // Best-effort: the live list is already on screen; only the next cold load loses its placeholder.
      }
    },
  };
}
