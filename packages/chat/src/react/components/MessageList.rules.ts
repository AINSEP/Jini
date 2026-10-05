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
