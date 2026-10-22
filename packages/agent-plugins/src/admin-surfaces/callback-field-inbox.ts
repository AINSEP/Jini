/**
 * @file A one-time, bounded holding place for the extra fields a provider returns on a completed
 * sign-in (for example the id of a resource the person picked during consent), between the host's
 * callback route and the plugin handler that asked for the sign-in.
 *
 * Why it exists: the callback arrives on a host route the plugin never sees, but the plugin's
 * surface handler is the one that must read and verify those fields. The host deposits them only
 * after the sign-in completed successfully; the plugin's `connections.takeCallbackFields` takes them
 * exactly once, and only under the same workspace, plugin, connection and attempt id, so another
 * plugin or a second read gets `null`. Entries expire and the inbox is capped, so an abandoned
 * sign-in cannot grow memory. It is in-process: a host that completes sign-ins on another process
 * implements the same two methods over its own store.
 */

export interface AdminSurfaceCallbackFieldKey {
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly connectionId: string;
  readonly attemptId: string;
}

/** How long a deposit waits to be taken: the sign-in attempt lifetime. */
const INBOX_TTL_MS = 10 * 60 * 1000;
/** Cap; the oldest entry is dropped first when full. */
const INBOX_MAX_ENTRIES = 256;

/** NUL cannot appear in any of these ids, so the joined key is unambiguous. */
const keyOf = (key: AdminSurfaceCallbackFieldKey) => [key.workspaceId, key.pluginId, key.connectionId, key.attemptId].join('\u0000');

/**
 * @param required.now - Clock in epoch milliseconds (injected so expiry is testable).
 * @returns `deposit` (host callback route, after a successful completion) and `take` (consume-once).
 * @complexity deposit is O(e) to sweep expired entries; take is O(1).
 */
export function createAdminSurfaceCallbackInbox(
  required: { readonly now: () => number },
  _optional: Record<string, never> = {},
) {
  // Map iteration order is insertion order, so the first entry is always the oldest.
  const entries = new Map<string, { readonly fields: Readonly<Record<string, string>>; readonly expiresAt: number }>();

  function sweep(nowMs: number): void {
    for (const [key, entry] of entries) if (entry.expiresAt <= nowMs) entries.delete(key);
    while (entries.size >= INBOX_MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  }

  return {
    /** Holds a completed sign-in's callback fields (call it only after the exchange succeeded). */
    deposit(input: AdminSurfaceCallbackFieldKey & { readonly fields: Readonly<Record<string, string>> }, _options: Record<string, never> = {}): void {
      const nowMs = required.now();
      sweep(nowMs);
      entries.set(keyOf(input), { fields: Object.freeze({ ...input.fields }), expiresAt: nowMs + INBOX_TTL_MS });
    },
    /** The fields, removed on the first read; `null` when never deposited, already taken, expired or keyed differently. */
    take(input: AdminSurfaceCallbackFieldKey, _options: Record<string, never> = {}): Readonly<Record<string, string>> | null {
      const key = keyOf(input);
      const entry = entries.get(key);
      if (entry === undefined) return null;
      entries.delete(key);
      return entry.expiresAt > required.now() ? entry.fields : null;
    },
  };
}
