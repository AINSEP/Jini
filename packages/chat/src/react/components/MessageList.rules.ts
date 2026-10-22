/**
 * @file Pure scroll rules for `MessageList` (no DOM, no React), split out so the component file
 * holds no logic.
 */
import type { ChatMessage } from '../../core/index.js';

/** Slack, in px, for treating "close enough to the bottom" as "at the bottom" — a fractional
 * scrollHeight/clientHeight rounding difference should not by itself stop the sticky-follow. */
export const AT_BOTTOM_THRESHOLD_PX = 4;

export function isScrolledToBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD_PX;
}

/**
 * The sticky-follow flag after a `scroll` event.
 *
 * At the bottom always re-sticks. Otherwise only a move UP (the position went down since the last
 * event) unsticks. A `scroll` event is dispatched a frame after the scroll that caused it, so the
 * event for an auto-scroll can arrive after more streamed rows already grew the content: the
 * position is unchanged but no longer at the bottom. Reading that as "the user scrolled away" is
 * what left a tool-heavy run's final reply below the fold (demo dry-run, 2026-10-05). Content growth
 * never lowers `scrollTop`; a user scrolling up always does.
 */
export function nextStickToBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  { wasSticking, previousScrollTop }: { wasSticking: boolean; previousScrollTop: number },
): boolean {
  if (isScrolledToBottom(el)) return true;
  return el.scrollTop < previousScrollTop ? false : wasSticking;
}

/**
 * Whether `next` starts a turn the user themself asked for, relative to `previous`: a user message
 * that was not there before (a send — `useConversation.sendMessage` appends it optimistically), or
 * an assistant message that newly entered `runStatus: 'queued'` (a retry, which resets the existing
 * assistant message in place rather than appending one). Streamed chatter on an already-running
 * turn is neither, so it never counts.
 */
export function startsNewTurn({ previous, next }: { previous: readonly ChatMessage[]; next: readonly ChatMessage[] }): boolean {
  const previousById = new Map(previous.map((message) => [message.id, message]));
  return next.some((message) => {
    const before = previousById.get(message.id);
    if (message.role === 'user') return before === undefined;
    return message.runStatus === 'queued' && before?.runStatus !== 'queued';
  });
}
