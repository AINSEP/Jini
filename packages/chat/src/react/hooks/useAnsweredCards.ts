/**
 * @module useAnsweredCards
 *
 * Which of a message's cards the person has already answered, by ext-event slot. A held-open
 * question's tool call stays open after the click while the confirmed work runs, so the event
 * stream alone still reads "waiting for an answer"; the card reports its own delivered answer here
 * and the activity line and countdown clear at once (owner, 2026-10-11).
 */
import { useCallback, useState } from 'react';
import type { IsAnsweredCard } from '../../core/index.js';

export interface AnsweredCards {
  /** Whether the slot's card was answered. */
  isAnswered(slot: string): boolean;
  /** Records the slot's card as answered. Idempotent. */
  markAnswered(slot: string): void;
  /** The same answer as `isAnswered`, keyed by an event — for `deriveRunActivity`. Stable while nothing new is answered. */
  isAnsweredCard: IsAnsweredCard;
}

/**
 * @param slotOf - Maps an ext event to its render slot (`extEventSlot`).
 * @complexity O(1) per lookup; O(answered cards) space.
 */
export function useAnsweredCards({ slotOf }: { slotOf: (card: { name: string; data: unknown }) => string }): AnsweredCards {
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const markAnswered = useCallback((slot: string) => {
    setAnswered((current) => (current.has(slot) ? current : new Set(current).add(slot)));
  }, []);
  const isAnswered = useCallback((slot: string) => answered.has(slot), [answered]);
  const isAnsweredCard = useCallback<IsAnsweredCard>((card) => answered.has(slotOf(card)), [answered, slotOf]);
  return { isAnswered, markAnswered, isAnsweredCard };
}
