/**
 * @file Member-specific credential revocation around the existing table adapter. Status, version,
 * prior-marker restoration and purge remain owned by createTableTrashAdapter; this wrapper only
 * prevents a pre-trash session or sign-in link from becoming usable again after restoration.
 */
import type { TrashAdapter } from "../../index.js";

/**
 * Revokes sessions and consumes outstanding links in the marker/index transaction. Restoration
 * restores the prior member status but never restores credentials. A failed revocation rolls back
 * the move. No member payload is read or parsed.
 * @complexity O(s + t) affected credentials; three bulk updates on hide, one on restore.
 * s sessions and t sign-in links. The marker adapter holds the shared member lock.
 */
export function createMemberTrashAdapter(
  { adapter, transaction, advanceCredentialFence, revokeSessions, consumeSignInLinks }: {
    adapter: TrashAdapter;
    transaction<T>(required: { run: () => Promise<T> }, optional?: Record<string, never>): Promise<T>;
    advanceCredentialFence(required: Parameters<TrashAdapter["hide"]>[0], optional?: Record<string, never>): Promise<void>;
    revokeSessions(required: Parameters<TrashAdapter["hide"]>[0], optional?: Record<string, never>): Promise<void>;
    consumeSignInLinks(required: Parameters<TrashAdapter["hide"]>[0], optional?: Record<string, never>): Promise<void>;
  },
  _optional: Record<string, never> = {},
): TrashAdapter {
  return {
    ...adapter,
    async hide(input, options = {}) {
      return transaction({ run: async () => {
        const result = await adapter.hide(input, options);
        if (result.ok && !result.noop) {
          await advanceCredentialFence(input);
          await revokeSessions(input);
          await consumeSignInLinks(input);
        }
        return result;
      } });
    },
    async unhide(input, options = {}) {
      return transaction({ run: async () => {
        const result = await adapter.unhide(input, options);
        if (result.ok && !result.noop) {
          // A delayed request may mint a link while hidden; restoring never revives that link.
          await advanceCredentialFence(input);
        }
        return result;
      } });
    },
  };
}
