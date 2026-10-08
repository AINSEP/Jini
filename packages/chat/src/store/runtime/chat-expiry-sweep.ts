import type { ChatHistoryMaintenance } from "../ports.js";
import { ChatStoreError } from "../errors.js";

/**
 * @file Retention for chat history: deletes every conversation whose `expires_at` has passed.
 *
 * This is the one chat operation that legitimately spans owners (`tenant-scope.ts`'s doc), so it
 * lives here, on the raw chat kernel, and never in a scoped store. Only guest chats carry an
 * `expires_at` (`chatExpiryFor`); a NULL one never expires. Messages, agent sessions and tool
 * approvals go with each conversation through `ON DELETE CASCADE`.
 */

/** How often {@link startChatExpirySweep} re-runs after its boot pass: hourly. */
export const CHAT_EXPIRY_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Deletes every conversation that expired at or before `now`.
 *
 * @param store the chat kernel, or the open `chat.db` handle whose kernel to use.
 * @returns how many conversations were deleted.
 * @complexity One bounded DELETE per 500 expired parents, plus the final partial/empty batch.
 */
export async function sweepExpiredChats(
  { maintenance }: { maintenance: ChatHistoryMaintenance },
  { now = Date.now() }: { now?: number } = {},
): Promise<number> {
  let total = 0;
  let deleted: number;
  try {
    do {
      deleted = await maintenance.sweepExpired({ now }, { limit: 500 });
      total += deleted;
    } while (deleted === 500);
  } catch (error) {
    // Preserve the host timer's existing onError collaborator and retry behavior.
    if (error instanceof ChatStoreError && error.cause !== undefined) throw error.cause;
    throw error;
  }
  return total;
}

/**
 * Runs {@link sweepExpiredChats} once now and then every `intervalMs`, until the returned stop
 * function is called. The timer is `unref`'d so it never keeps the process alive. A failed pass is
 * reported through `onError` and the next pass still runs. A tick that fires while a pass is still
 * running is skipped, so passes never overlap.
 *
 * @returns `stop`: clears the timer and resolves once the pass in flight (if any) has finished, so
 *   the store can be closed right after it. Safe to call more than once.
 */
export function startChatExpirySweep(
  { maintenance }: { maintenance: ChatHistoryMaintenance },
  options: {
    readonly intervalMs?: number;
    readonly now?: () => number;
    readonly onError?: (error: unknown) => void;
  } = {}
): () => Promise<void> {
  const { intervalMs = CHAT_EXPIRY_SWEEP_INTERVAL_MS, now = Date.now } = options;
  const onError =
    options.onError ??
    ((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`[chat-expiry-sweep] sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  let active: Promise<void> | undefined;
  const pass = (): void => {
    if (active !== undefined) return;
    active = sweepExpiredChats({ maintenance }, { now: now() })
      .then(() => undefined, onError)
      .finally(() => {
        active = undefined;
      });
  };
  pass();
  const timer = setInterval(pass, intervalMs);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await active;
  };
}
