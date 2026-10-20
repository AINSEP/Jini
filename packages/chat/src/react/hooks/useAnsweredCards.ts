/**
 * @module useAnsweredCards
 *
 * Which of a message's cards the person has already answered, by ext-event slot. A held-open
 * question's tool call stays open after the click while the confirmed work runs, so the event
 * stream alone can still read "waiting for an answer"; persisted receipts or the card delivery report
 * clear the activity line and countdown. The receipt owns the bubble once it arrives.
 */
import { useCallback, useMemo, useState } from 'react';
import { acceptedInputEvent } from '../../core/accepted-input.js';
import type { ExtEventGroup } from './useExtEventGroups.js';
import type { AgentEvent, IsAnsweredCard } from '../../core/index.js';

export interface AnsweredCards {
  /** Whether the slot's card was answered. */
  isAnswered(slot: string): boolean;
  /** Records the slot's card as answered. Idempotent. */
  markAnswered(slot: string, answerText?: string): void;
  /** The receipt text takes precedence over the transient delivery text. */
  answerText(slot: string): string | undefined;
  /** Whether a user_message event already renders this answer. */
  isRecorded(slot: string): boolean;
  /** The same answer as `isAnswered`, keyed by an event — for `deriveRunActivity`. Stable while nothing new is answered. */
  isAnsweredCard: IsAnsweredCard;
}

/**
 * @param slotOf - Maps an ext event to its render slot (`extEventSlot`).
 * @param events - Accepted-input-projected events, including persisted or optimistic answer receipts.
 * @param groups - Groups carrying their original tool id; equal answer text is never identity.
 * @returns Slot lookups and an idempotent delivery recorder; only that recorder changes React state.
 * @complexity O(events + groups) projection, O(1) lookups; O(events + answered cards) space.
 */
export function useAnsweredCards({ slotOf, events = [], groups = [] }: {
  slotOf: (card: { name: string; data: unknown }) => string;
  events?: readonly AgentEvent[];
  groups?: readonly ExtEventGroup[];
}): AnsweredCards {
  const [answered, setAnswered] = useState<ReadonlyMap<string, string | undefined>>(() => new Map());
  // MOVE: Match by tool identity so receipt replay hides only its own card, even for equal answers.
  const recorded = useMemo(() => {
    const receipts = new Map<string, string>();
    for (const event of events) {
      const receipt = acceptedInputEvent({ event });
      if (receipt?.data.toolUseId) receipts.set(receipt.data.toolUseId, receipt.data.text);
    }
    const slots = new Map<string, string>();
    for (const group of groups) {
      const text = group.call?.id === undefined ? undefined : receipts.get(group.call.id);
      if (text !== undefined) slots.set(group.slot, text);
    }
    return slots;
  }, [events, groups]);
  const markAnswered = useCallback((slot: string, answerText?: string) => {
    setAnswered((current) => (current.has(slot) ? current : new Map(current).set(slot, answerText)));
  }, []);
  const isAnswered = useCallback((slot: string) => recorded.has(slot) || answered.has(slot), [answered, recorded]);
  const answerText = useCallback((slot: string) => recorded.get(slot) ?? answered.get(slot), [answered, recorded]);
  const isRecorded = useCallback((slot: string) => recorded.has(slot), [recorded]);
  const isAnsweredCard = useCallback<IsAnsweredCard>((card) => isAnswered(slotOf(card)), [isAnswered, slotOf]);
  return { isAnswered, markAnswered, isAnsweredCard, answerText, isRecorded };
}
