import { matchesOptions } from './question.js';
import type { AskChoicePendingStore, AskChoiceQuestion } from './types.js';

/** Optional in-memory adapter. Use one instance for all callbacks belonging to the same host.
 * IDs must be unpredictable and unique; the caller owns their generation and the ticket lifetime.
 * Expired tickets are swept on mint; redeem consumes even a mismatched or expired ticket.
 */
export function createAskChoiceAnswerTicketStore({ now, newTicketId, ttlMs }: {
  now: (args: Record<string, never>) => number;
  newTicketId: (args: Record<string, never>) => string;
  ttlMs: number;
}): AskChoicePendingStore {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttlMs must be a positive finite number');
  const pending = new Map<string, { principalId: string; expiresAtMs: number; question: AskChoiceQuestion }>();
  return {
    mint({ principalId, question }) {
      const nowMs = now({});
      for (const [ticket, entry] of pending) if (entry.expiresAtMs <= nowMs) pending.delete(ticket);
      const ticket = newTicketId({});
      if (!ticket || pending.has(ticket)) throw new Error('Ticket ID must be non-empty and unique');
      // Snapshot the displayed options so caller mutation cannot change what this ticket authorizes.
      pending.set(ticket, { principalId, expiresAtMs: nowMs + ttlMs, question: structuredClone(question) });
      return ticket;
    },
    redeem({ ticket, principalId, params }) {
      if (ticket === undefined) return false;
      const entry = pending.get(ticket);
      if (!entry) return false;
      pending.delete(ticket);
      return entry.expiresAtMs > now({}) && entry.principalId === principalId && matchesOptions({ question: entry.question, params });
    },
  };
}
