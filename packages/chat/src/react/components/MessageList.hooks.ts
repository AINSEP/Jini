/**
 * @file `MessageList`'s scroll-anchoring state, split out of the component per this package's
 * hooks-file convention (see `AttachmentPreviewModal.hooks.ts`). Pure DOM scroll-anchoring via a ref
 * lives here (presentational), not in the headless `useConversation` hook, per that hook's own
 * "transport-agnostic hooks never touch DOM" contract.
 */
import { useEffect, useRef, type RefObject, type UIEvent } from 'react';
import type { ChatMessage } from '../../core/index.js';
import { nextStickToBottom, startsNewTurn } from './MessageList.rules.js';

export interface MessageListAutoScroll {
  containerRef: RefObject<HTMLDivElement | null>;
  onScroll: (event: UIEvent<HTMLElement>) => void;
}

export function useMessageListAutoScroll(
  { messages, scrollIntent }: { messages: ChatMessage[]; scrollIntent: boolean },
  { onScrolled }: { onScrolled?: () => void } = {},
): MessageListAutoScroll {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Whether the transcript was scrolled to its bottom as of the last user scroll or programmatic
  // scroll-to-bottom — read by the ResizeObserver effect below, which only ever sees the DOM AFTER a
  // resize already happened and so cannot recompute "was this at the bottom" from current values.
  // Starts true: a freshly mounted pane opens on the latest turn, same as scrollIntent's own default.
  const stickToBottomRef = useRef(true);
  const previousMessagesRef = useRef<readonly ChatMessage[]>(messages);
  // `scrollTop` at the previous `scroll` event — `nextStickToBottom` needs the direction of travel.
  // Only scroll events write it (a browser fires one for programmatic scrolls too). Starts at
  // Infinity, "no position seen yet", so a first event away from the bottom unsticks as it always did.
  const lastScrollTopRef = useRef(Number.POSITIVE_INFINITY);

  // Runs BEFORE the scroll effect below (effects run in declaration order), so a send re-sticks in
  // time for that same commit's scroll. The user's own send (or retry) is an explicit "take me to
  // the latest turn": without this, a user who had scrolled up to read history and then sent stayed
  // parked up there, because the stick gate below — correct for streamed chatter — also swallowed
  // their own send (owner-reported "Chat auto-scroll still sticks", todos audit 2026-10-04).
  useEffect(() => {
    if (startsNewTurn({ previous: previousMessagesRef.current, next: messages })) {
      stickToBottomRef.current = true;
    }
    previousMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!scrollIntent) return;
    const el = containerRef.current;
    // Gated on `stickToBottomRef`, same as the ResizeObserver effect below: `scrollIntent` turns
    // true on EVERY streamed event (tool-call chatter included, not just a finished reply — see
    // `useConversation.applyRunToAssistantMessage`), so scrolling unconditionally here yanked a user
    // who had deliberately scrolled up to read history back to the bottom on the very next chunk
    // (owner-reported, 2026-08-30). `stickToBottomRef` already reflects the user's own last scroll
    // gesture via the `onScroll` handler below, captured BEFORE this content change, so it is safe
    // to trust here.
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    onScrolled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollIntent, messages]);

  // Re-sticks to the bottom when a message ROW grows after mount with no accompanying `messages`
  // change — the exact case an embedded MCP-UI/A2UI surface hits: it mounts at an initial guessed
  // height (`preferredFrameSize` or `DEFAULT_INITIAL_HEIGHT`), then reports its real, often much
  // taller content height asynchronously via `ui/notifications/size-changed`, entirely inside that
  // surface's own React state (`McpUiHost`). The effect above never re-runs for that, so without this
  // a surface which grows after the one-shot scroll leaves its own action buttons — or, once it
  // resolves, the assistant's next reply — below the stale "bottom" with nothing to bring them back
  // into view. Observes each direct child (one per message row) rather than the scroll container
  // itself: the container's own box is held fixed by its flex/overflow layout, so only its CONTENT
  // grows, which `ResizeObserver` only reports for the element whose box is actually changing.
  // Re-created per `messages` change so a newly mounted row is observed too. Gated on
  // `stickToBottomRef` so a human who scrolled up to read history is never yanked back down by an
  // unrelated row resizing elsewhere in the transcript.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return;
      el.scrollTop = el.scrollHeight;
    });
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [messages]);

  const onScroll = (event: UIEvent<HTMLElement>) => {
    const el = event.currentTarget;
    stickToBottomRef.current = nextStickToBottom(el, { wasSticking: stickToBottomRef.current, previousScrollTop: lastScrollTopRef.current });
    lastScrollTopRef.current = el.scrollTop;
  };

  return { containerRef, onScroll };
}
